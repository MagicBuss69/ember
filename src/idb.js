const DB_NAME = "ember";
const DB_VERSION = 1;
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is busy."));
  });
}

export async function kvGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || request.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB read aborted."));
    };
  });
}

export async function kvSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB write aborted."));
    };
  });
}

export async function kvClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB clear aborted."));
    };
  });
}

export async function loadState() {
  try {
    const stored = await kvGet("state");
    if (stored) return stored;
  } catch {
    /* private mode or a blocked database — try the mirror */
  }
  try {
    const raw = localStorage.getItem("ember-state");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

let saveQueue = Promise.resolve();

export function saveState(state) {
  const snapshot = structuredClone(state);
  const run = async () => {
    let idbOk = true;
    try {
      await kvSet("state", snapshot);
    } catch {
      idbOk = false;
    }
    try {
      localStorage.setItem("ember-state", JSON.stringify(snapshot));
    } catch {
      if (!idbOk) throw new Error("This phone refused to save.");
    }
    return idbOk;
  };
  const next = saveQueue.then(run, run);
  saveQueue = next.catch(() => {});
  return next;
}
