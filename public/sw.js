/* Ember service worker.
   Reminders are decided by the page and stored in IndexedDB as `reminders`.
   This worker can show one only when Chrome wakes it: a periodic sync
   (installed PWA, usually 12h+), a message from the open page, or a click.
   Exact clock alarms are not available in shipping Chrome. See the README.
*/
const BASE = "/ember/";
const CACHE = "ember-shell-v2";
const DB_NAME = "ember";
const DB_VERSION = 1;
const STORE = "kv";
const PERIODIC_TAG = "ember-reminders";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith(`${BASE}@`) ||
    url.pathname.startsWith(`${BASE}src/`) ||
    url.pathname.startsWith(`${BASE}node_modules`)
  ) {
    return;
  }
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await cache.match(BASE)) || (await cache.match(`${BASE}index.html`)) || Response.error();
    }
    return Response.error();
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_TAG) event.waitUntil(pump());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_REMINDERS") event.waitUntil(pump());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const date = event.notification.data?.date || "";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "OPEN_TODAY", date });
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(BASE);
      return undefined;
    })(),
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function kvGet(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

function kvSet(key, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

async function pump() {
  const reminders = (await kvGet("reminders")) || [];
  const now = Date.now();
  for (const record of reminders) {
    if (now < record.when || now >= record.expires) continue;
    const flagged = await kvGet(`flag:${record.tag}`);
    if (flagged) continue;
    await self.registration.showNotification(record.title, {
      body: record.body,
      tag: record.tag,
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/badge-96.png`,
      data: { date: record.date, taskId: record.taskId },
    });
    await kvSet(`flag:${record.tag}`, now);
  }
}
