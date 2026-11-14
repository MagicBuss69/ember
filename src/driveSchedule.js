import { dateKey, addDays, formatPretty, stockholmParts } from "./time.js";

export const DRIVE_DEBOUNCE_MS = 2 * 60 * 1000;
export const DRIVE_THROTTLE_MS = 30 * 60 * 1000;
export const DRIVE_OPEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isAutoBackupEnabled(settings, clientId) {
  return Boolean(
    String(clientId || "").trim()
      && settings?.driveLinked
      && settings?.driveAutoBackup !== false,
  );
}

export function parseLastBackupMs(settings) {
  const iso = settings?.driveLastBackupAt;
  if (typeof iso === "string" && iso.trim()) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const day = settings?.driveLastBackupOn;
  if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const parsed = Date.parse(`${day}T00:00:00.000Z`);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

/** True on app open when Drive is linked, auto-backup is on, and the last backup is >24h old (or missing). */
export function shouldAutoBackupOnOpen({
  settings,
  clientId,
  nowMs,
  maxAgeMs = DRIVE_OPEN_MAX_AGE_MS,
}) {
  if (!isAutoBackupEnabled(settings, clientId)) return false;
  const lastMs = parseLastBackupMs(settings);
  if (!lastMs) return true;
  return nowMs - lastMs > maxAgeMs;
}

/**
 * Pure delay calculator (ms) for an automatic Drive backup after a state change.
 * Debounces ~2 minutes from the latest edit and throttles to at most once per 30 minutes.
 * Returns `null` when no automatic backup should be scheduled.
 */
export function computeAutoBackupDelay({
  settings,
  clientId,
  lastChangeMs,
  lastAttemptMs = 0,
  nowMs,
  debounceMs = DRIVE_DEBOUNCE_MS,
  throttleMs = DRIVE_THROTTLE_MS,
}) {
  if (!isAutoBackupEnabled(settings, clientId)) return null;
  if (!Number.isFinite(lastChangeMs) || lastChangeMs <= 0) return null;
  const debounceUntil = lastChangeMs + debounceMs;
  const lastRun = Math.max(parseLastBackupMs(settings), Number(lastAttemptMs) || 0);
  const throttleUntil = lastRun > 0 ? lastRun + throttleMs : 0;
  const fireAt = Math.max(debounceUntil, throttleUntil);
  return Math.max(0, fireAt - nowMs);
}

export function formatLastBackupTime(settings, now = new Date()) {
  const iso = settings?.driveLastBackupAt;
  if (typeof iso === "string" && iso.trim()) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms > 0) {
      const parts = stockholmParts(new Date(ms));
      const hhmm = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
      const today = dateKey(now);
      if (parts.key === today) return `today ${hhmm}`;
      if (parts.key === addDays(today, -1)) return `yesterday ${hhmm}`;
      return `${formatPretty(parts.key)} ${hhmm}`;
    }
  }
  if (typeof settings?.driveLastBackupOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(settings.driveLastBackupOn)) {
    return formatPretty(settings.driveLastBackupOn);
  }
  return "never";
}

export function createAutoBackupController({
  getContext,
  runBackup,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  debounceMs = DRIVE_DEBOUNCE_MS,
  throttleMs = DRIVE_THROTTLE_MS,
  maxAgeMs = DRIVE_OPEN_MAX_AGE_MS,
}) {
  let timer = null;
  let pendingChangeMs = 0;
  let queuedChangeMs = 0;
  let lastAttemptMs = 0;
  let running = false;

  function cancelTimer() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function arm() {
    cancelTimer();
    if (!pendingChangeMs) return null;
    const { settings, clientId } = getContext();
    const delay = computeAutoBackupDelay({
      settings,
      clientId,
      lastChangeMs: pendingChangeMs,
      lastAttemptMs,
      nowMs: now(),
      debounceMs,
      throttleMs,
    });
    if (delay == null) {
      pendingChangeMs = 0;
      return null;
    }
    timer = setTimer(() => {
      timer = null;
      execute();
    }, delay);
    return delay;
  }

  async function execute() {
    if (running) return false;
    const { settings, clientId } = getContext();
    if (!isAutoBackupEnabled(settings, clientId)) {
      pendingChangeMs = 0;
      return false;
    }
    cancelTimer();
    running = true;
    lastAttemptMs = now();
    pendingChangeMs = 0;
    try {
      await runBackup();
      return true;
    } finally {
      running = false;
      if (queuedChangeMs) {
        pendingChangeMs = queuedChangeMs;
        queuedChangeMs = 0;
        arm();
      }
    }
  }

  return {
    noteChange() {
      const ts = now();
      if (running) {
        queuedChangeMs = ts;
        return null;
      }
      pendingChangeMs = ts;
      return arm();
    },
    checkOnOpen() {
      const { settings, clientId } = getContext();
      if (!shouldAutoBackupOnOpen({ settings, clientId, nowMs: now(), maxAgeMs })) {
        return false;
      }
      execute();
      return true;
    },
    recheck() {
      const { settings, clientId } = getContext();
      if (!isAutoBackupEnabled(settings, clientId)) {
        cancelTimer();
        pendingChangeMs = 0;
        queuedChangeMs = 0;
        return null;
      }
      return arm();
    },
    markCompleted(atMs = now()) {
      cancelTimer();
      pendingChangeMs = 0;
      queuedChangeMs = 0;
      lastAttemptMs = atMs;
    },
    cancel() {
      cancelTimer();
      pendingChangeMs = 0;
      queuedChangeMs = 0;
    },
  };
}
