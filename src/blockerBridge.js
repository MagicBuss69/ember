import { Capacitor, registerPlugin } from "@capacitor/core";
import { challengeSnapshot } from "./challenges.js";
import { dateKey } from "./time.js";

export const DEFAULT_BLOCKED_PACKAGES = [
  "com.google.android.youtube",
  "com.zhiliaoapp.musically",
];

const EmberBlocker = registerPlugin("EmberBlocker");

export function buildBlockerSnapshot(state, now = new Date()) {
  const snap = challengeSnapshot(state, now);
  const locked = snap.locked;
  const mode = state.settings?.blockMode === "quests" ? "quests" : "pushups";
  return {
    locked,
    blockMode: mode,
    unlockMinutes: Math.max(1, Math.min(180, Math.round(Number(state.settings?.unlockMinutes) || 15))),
    pushupMax: Math.max(1, Math.min(300, Math.round(Number(state.settings?.pushupMax) || 10))),
    packages: (state.settings?.blockedPackages?.length
      ? state.settings.blockedPackages
      : DEFAULT_BLOCKED_PACKAGES),
    challengeActive: snap.challengeActive,
    challengeDeadline: snap.challengeDeadline || "",
    challengeLabel: snap.current?.label || "",
    challengeReps: Math.max(0, Math.round(Number(snap.current?.reps) || 0)),
    challengeIsSeconds: Boolean(snap.current?.isSeconds),
    quiet: snap.quiet,
    difficulty: snap.difficulty,
    nextRollAt: snap.nextRollAt || "",
    challengeId: snap.current?.id || "",
    today: dateKey(now),
  };
}

export async function drainNativeInbox(state) {
  if (!Capacitor.isNativePlatform()) return state;
  try {
    const result = await EmberBlocker.drainInbox();
    const events = Array.isArray(result?.events) ? result.events : [];
    if (!events.length) return state;
    const next = structuredClone(state);
    next.challengeInbox = [...(next.challengeInbox || []), ...events];
    return next;
  } catch {
    return state;
  }
}

export async function consumeChallengeIntent() {
  if (!Capacitor.isNativePlatform()) return { openChallenge: false, confirmChallenge: false };
  try {
    const result = await EmberBlocker.consumeOpenIntent();
    return {
      openChallenge: Boolean(result?.openChallenge),
      confirmChallenge: Boolean(result?.confirmChallenge),
    };
  } catch {
    return { openChallenge: false, confirmChallenge: false };
  }
}

export async function startPushupTest() {
  if (!Capacitor.isNativePlatform()) return false;
  await EmberBlocker.startPushupTest();
  return true;
}

export async function shareNativeBackup(filename, text) {
  if (!Capacitor.isNativePlatform()) return false;
  await EmberBlocker.shareBackup({ filename, text });
  return true;
}

export async function openAccessibilitySettings() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await EmberBlocker.openAccessibilitySettings();
    return true;
  } catch {
    return false;
  }
}

export async function pushBlockerSnapshot(state, now = new Date()) {
  const snapshot = buildBlockerSnapshot(state, now);
  if (!Capacitor.isNativePlatform()) return snapshot;
  try {
    await EmberBlocker.setSnapshot({ json: JSON.stringify(snapshot) });
  } catch {
    /* web / plugin missing */
  }
  return snapshot;
}

export async function listLaunchableApps() {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await EmberBlocker.listLaunchableApps();
    return Array.isArray(result?.apps) ? result.apps : [];
  } catch {
    return [];
  }
}

export async function filterInstalledDefaults(packages = DEFAULT_BLOCKED_PACKAGES) {
  const installed = await listLaunchableApps();
  if (!installed.length) return packages;
  const ids = new Set(installed.map((row) => row.id));
  return packages.filter((id) => ids.has(id));
}

export function isNativeBlocker() {
  return Capacitor.isNativePlatform();
}