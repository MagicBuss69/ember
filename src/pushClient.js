import { VAPID_PUBLIC_KEY, WORKER_URL } from "./config.js";
import { buildSchedule } from "./schedule.js";
import { dateKey } from "./time.js";

function b64urlToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function pushConfigured() {
  return Boolean(String(WORKER_URL || "").trim() && String(VAPID_PUBLIC_KEY || "").trim());
}

function endpoint(path) {
  return `${String(WORKER_URL).replace(/\/$/, "")}${path}`;
}

async function workerFetch(path, token, options) {
  const response = await fetch(endpoint(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error("The reminder worker refused that.");
  return response;
}

export async function syncPushSchedule(state) {
  if (!pushConfigured() || !state.settings?.workerToken || !state.settings?.pushOn) return;
  const schedule = buildSchedule(state, dateKey(new Date()));
  await workerFetch("/api/schedule", state.settings.workerToken, {
    method: "PUT",
    body: JSON.stringify(schedule),
  });
}

export async function enableClosedReminders(state) {
  if (!pushConfigured()) throw new Error("Closed-app reminders are not set up on this copy of Ember.");
  const token = String(state.settings?.workerToken || "").trim();
  if (!token) throw new Error("Add the worker token first. It stays on this phone.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked in Chrome's site settings.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  await workerFetch("/api/subscribe", token, {
    method: "POST",
    body: JSON.stringify({
      subscription: json,
      schedule: buildSchedule(state, dateKey(new Date())),
    }),
  });
}

export async function disableClosedReminders(state) {
  const token = String(state.settings?.workerToken || "").trim();
  if (!pushConfigured() || !token) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    /* the phone can drop the subscription even if the worker is unreachable */
  }
  try {
    await workerFetch("/api/subscribe", token, { method: "DELETE" });
  } catch {
    /* local off switch still stands */
  }
}
