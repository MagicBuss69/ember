import { Capacitor, registerPlugin } from "@capacitor/core";
import { CHALLENGE_DEADLINE_MS, challengeSnapshot, isQuietHour } from "./challenges.js";
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

/**
 * The native snapshot is what the alarm and notification were showing.
 * If the web view opens before IndexedDB has that challenge, put it back
 * so the exercise, reps, countdown, and Done button can render.
 */
export function restoreChallengeFromSnapshot(state, raw, now = new Date()) {
  if (!state || typeof state !== "object") return state;
  if (isQuietHour(now, state.settings)) return state;
  let snap = raw;
  if (typeof raw === "string") {
    try {
      snap = JSON.parse(raw);
    } catch {
      return state;
    }
  }
  if (!snap || typeof snap !== "object" || !snap.challengeActive || snap.quiet) return state;
  const deadlineMs = Date.parse(snap.challengeDeadline || "");
  if (!(deadlineMs > now.getTime())) return state;
  const current = state.challenges?.current;
  if (current?.label && Date.parse(current.deadlineAt) > now.getTime()) return state;
  const next = structuredClone(state);
  next.challenges = next.challenges && typeof next.challenges === "object"
    ? next.challenges
    : { current: null, nextRollAt: null, difficultyStep: 0, processedInbox: [] };
  next.challenges.current = {
    id: String(snap.challengeId || current?.id || `snap-${deadlineMs}`),
    typeId: String(snap.challengeTypeId || current?.typeId || "pushups"),
    label: String(snap.challengeLabel || "Push-ups"),
    reps: Math.max(1, Math.round(Number(snap.challengeReps) || 10)),
    isSeconds: Boolean(snap.challengeIsSeconds),
    difficulty: Math.max(1, Math.round(Number(snap.difficulty) || 1)),
    openedAt: new Date(deadlineMs - CHALLENGE_DEADLINE_MS).toISOString(),
    deadlineAt: new Date(deadlineMs).toISOString(),
  };
  return next;
}

export async function hydrateChallengeFromNative(state, now = new Date()) {
  if (!Capacitor.isNativePlatform()) return state;
  try {
    const result = await EmberBlocker.readSnapshot();
    return restoreChallengeFromSnapshot(state, result?.json, now);
  } catch {
    return state;
  }
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

/**
 * Opens every blocked app for `minutes` (extends a running unlock). Native only.
 * Resolves the ISO end time, or "" on web / failure.
 */
export async function grantRewardUnlock(minutes, reason = "reward") {
  if (!Capacitor.isNativePlatform()) return "";
  const mins = Math.max(0, Math.min(240, Math.round(Number(minutes) || 0)));
  if (!mins) return "";
  try {
    const result = await EmberBlocker.grantUnlock({ minutes: mins, reason: String(reason || "reward").slice(0, 60) });
    return typeof result?.until === "string" ? result.until : "";
  } catch {
    return "";
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

export async function blockerPermissionStatus() {
  if (!Capacitor.isNativePlatform()) return { overlay: false, fullScreen: false, native: false };
  try {
    const result = await EmberBlocker.blockerPermissions();
    return { overlay: Boolean(result?.overlay), fullScreen: Boolean(result?.fullScreen), native: true };
  } catch {
    return { overlay: false, fullScreen: false, native: true };
  }
}

export async function openOverlaySettings() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await EmberBlocker.openOverlaySettings();
    return true;
  } catch {
    return false;
  }
}

export async function openFullScreenSettings() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await EmberBlocker.openFullScreenSettings();
    return true;
  } catch {
    return false;
  }
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