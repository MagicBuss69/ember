/* Ember service worker.
   Reminders are decided by the page and stored in IndexedDB as `reminders`.
   This worker can show one only when Chrome wakes it: a periodic sync
   (installed PWA, usually 12h+), a message from the open page, or a click.
   Exact clock alarms are not available in shipping Chrome. See the README.
*/
const BASE = "/ember/";
const ICON_URL = `${BASE}icons/icon-192.png`;
const BADGE_URL = `${BASE}icons/badge-96.png`;
const CACHE = "ember-shell-v34";
const ART_WEBP = [
  "badge-fullday",
  "badge-streak7",
  "currency",
  "fx-nova",
  "fx-shards",
  "life-reward",
  "skin-ember",
  "skin-ice",
  "skin-void",
  "sound-arcade",
  "sound-chime",
  "theme-aurora",
  "theme-blood",
  "theme-ember",
  "theme-frost",
  "theme-ink",
  "theme-pine",
  "title-hunter",
  "title-monarch",
  "title-shadow",
];
const DB_NAME = "ember";
const DB_VERSION = 1;
const STORE = "kv";
const PERIODIC_TAG = "ember-reminders";

const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  ICON_URL,
  BADGE_URL,
  `${BASE}icons/icon-512.png`,
  `${BASE}icons/icon-maskable-512.png`,
  ...ART_WEBP.map((name) => `${BASE}art/${name}.webp`),
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch {
        /* a missing shell file must not block install */
      }
    }));
  })());
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
      return (await cache.match(request))
        || (await cache.match(BASE))
        || (await cache.match(`${BASE}index.html`))
        || offlineDocument();
    }
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

function offlineDocument() {
  const html = `<!doctype html><html lang="en" translate="no"><head><meta charset="utf-8"><meta name="google" content="notranslate"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ember</title></head><body style="margin:0;background:#100e0c;color:#f6f1ea;font-family:system-ui,sans-serif;padding:24px"><h1>Ember is offline</h1><p>Open Ember once while you are online. After that it stays on this phone.</p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Ember", body: event.data ? event.data.text() : "" };
  }
  const tag = data.tag || "ember-reminder";
  event.waitUntil((async () => {
    const flagKey = `flag:${tag}`;
    // The phone may already have shown this quest. Re-showing the same tag
    // silently replaces it instead of buzzing a second time.
    const already = await kvGet(flagKey).catch(() => null);
    await self.registration.showNotification(data.title || "Ember", {
      body: data.body || "",
      tag,
      silent: Boolean(already),
      renotify: false,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { date: data.date || "" },
    });
    if (!already) await kvSet(flagKey, Date.now()).catch(() => {});
  })());
});

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
      if (self.clients.openWindow) return self.clients.openWindow(`${BASE}#today`);
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
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { date: record.date, taskId: record.taskId },
    });
    await kvSet(`flag:${record.tag}`, now);
  }
}
