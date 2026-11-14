import { SLOTS, SLOT_LABEL } from "./constants.js";
import { kvGet, kvSet } from "./idb.js";
import { syncPushSchedule } from "./pushClient.js";
import { addDays, dateKey, zonedTimeToUtc } from "./time.js";

const PERIODIC_TAG = "ember-reminders";
const BASE = import.meta.env.BASE_URL;

function publicUrl(file) {
  return `${BASE}${file}`;
}

/** One tag per quest occurrence, shared with the worker's push, so a reminder never shows twice. */
export function questTag(date, time, title) {
  return `quest:${date}:${time}:${title}`;
}

export function reminderRecords(state, now = new Date()) {
  const today = dateKey(now);
  const day = state.days?.[today];
  if (!day) return [];
  const expires = zonedTimeToUtc(addDays(today, 1), "00:00");
  const records = [];
  for (const slot of SLOTS) {
    for (const task of day.slots?.[slot] || []) {
      if (!task.time || task.done) continue;
      records.push({
        tag: questTag(today, task.time, task.title),
        title: task.title,
        body: `${SLOT_LABEL[slot]} · ${task.time}`,
        when: zonedTimeToUtc(today, task.time),
        expires,
        date: today,
        taskId: task.id,
      });
    }
  }
  return records;
}

export function triggersAvailable() {
  return typeof TimestampTrigger === "function";
}

async function showNow(registration, record) {
  await registration.showNotification(record.title, {
    body: record.body,
    tag: record.tag,
    icon: publicUrl("icons/icon-192.png"),
    badge: publicUrl("icons/badge-96.png"),
    data: { date: record.date, taskId: record.taskId },
    vibrate: [18, 40, 18],
  });
}

export async function syncReminderSchedule(state) {
  const records = reminderRecords(state, new Date());
  try {
    await kvSet("reminders", records);
  } catch {
    /* the open-app timer still runs */
  }
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return records;
  const permission = globalThis.Notification?.permission;
  let registration = null;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    return records;
  }
  if (permission === "granted") {
    await scheduleOrPump(registration, records);
  }
  armTimer(records);
  syncPushSchedule(state).catch(() => {});
  return records;
}

async function scheduleOrPump(registration, records) {
  const now = Date.now();
  try {
    const existing = await registration.getNotifications({ includeTriggered: true });
    const live = new Set(records.map((record) => record.tag));
    for (const note of existing) {
      if (note.tag?.startsWith("quest:") && !live.has(note.tag)) note.close();
    }
  } catch {
    /* includeTriggered is part of the unshipped triggers API */
  }
  if (triggersAvailable()) {
    for (const record of records) {
      if (record.when <= now + 800) continue;
      const scheduled = await kvGet(`sched:${record.tag}`).catch(() => null);
      if (scheduled) continue;
      try {
        await registration.showNotification(record.title, {
          body: record.body,
          tag: record.tag,
          icon: publicUrl("icons/icon-192.png"),
          badge: publicUrl("icons/badge-96.png"),
          data: { date: record.date, taskId: record.taskId },
          showTrigger: new TimestampTrigger(record.when),
        });
        await kvSet(`sched:${record.tag}`, record.when);
        await kvSet(`flag:${record.tag}`, record.when);
      } catch {
        /* fall through to the open-app timer */
      }
    }
  }
  await pumpDue(registration, records);
}

async function pumpDue(registration, records) {
  const now = Date.now();
  for (const record of records) {
    if (now < record.when || now >= record.expires) continue;
    const flagged = await kvGet(`flag:${record.tag}`).catch(() => null);
    if (flagged) continue;
    try {
      await showNow(registration, record);
      await kvSet(`flag:${record.tag}`, now);
    } catch {
      /* permission or a closed registration */
    }
  }
}

let timer = 0;
function armTimer(records) {
  clearTimeout(timer);
  const now = Date.now();
  const next = records.filter((record) => record.when > now).sort((a, b) => a.when - b.when)[0];
  const delay = next ? Math.min(Math.max(1000, next.when - now), 60_000) : 60_000;
  timer = setTimeout(() => {
    syncReminderSchedule(latestState()).catch(() => {});
  }, delay);
}

let latestState = () => ({ days: {} });
export function watchReminders(getState) {
  latestState = getState;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncReminderSchedule(getState()).catch(() => {});
    }
  });
  window.addEventListener("focus", () => {
    syncReminderSchedule(getState()).catch(() => {});
  });
}

export async function enableNotifications() {
  if (!globalThis.Notification) {
    return { ok: false, reason: "This browser can't show notifications." };
  }
  const result = await Notification.requestPermission();
  if (result !== "granted") {
    return { ok: false, reason: "Notifications are blocked. You can allow them in Chrome's site settings." };
  }
  const periodic = await registerPeriodic();
  return { ok: true, periodic };
}

export async function registerPeriodic() {
  if (!navigator.serviceWorker) return { ok: false, reason: "unsupported" };
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.periodicSync) return { ok: false, reason: "unsupported" };
    await registration.periodicSync.register(PERIODIC_TAG, { minInterval: 12 * 60 * 60 * 1000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name || "blocked" };
  }
}

export async function periodicStatus() {
  if (!navigator.serviceWorker) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.periodicSync) return "unsupported";
    const tags = await registration.periodicSync.getTags();
    return tags.includes(PERIODIC_TAG) ? "registered" : "idle";
  } catch {
    return "idle";
  }
}

export async function registerServiceWorker() {
  if (!navigator.serviceWorker) return null;
  try {
    return await navigator.serviceWorker.register(publicUrl("sw.js"), { scope: BASE });
  } catch {
    return null;
  }
}
