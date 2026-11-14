import { SLOTS, THEMES } from "./constants.js";
import { createInitialState, validTime } from "./domain.js";
import { levelFor } from "./economy.js";

const LIMITS = {
  days: 4000,
  workouts: 5000,
  events: 20000,
  log: 80,
};

export function sanitizeImport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("That file isn't an Ember backup.");
  }
  if (raw.version !== 1) throw new Error("This backup is from a different Ember version.");
  const size = JSON.stringify(raw).length;
  if (size > 4_000_000) throw new Error("That backup is too large for this phone.");

  const base = createInitialState(new Date());
  const state = base;
  state.startedOn = isDate(raw.startedOn) ? raw.startedOn : base.startedOn;
  state.settings = {
    geminiApiKey: clip(raw.settings?.geminiApiKey, 200),
    goals: clip(raw.settings?.goals, 2000) || base.settings.goals,
    theme: "ember",
    sound: raw.settings?.sound !== false,
    haptics: raw.settings?.haptics !== false,
    dismissedHint: Boolean(raw.settings?.dismissedHint),
    geminiKeyStatus: clip(raw.settings?.geminiKeyStatus, 20),
    driveLinked: Boolean(raw.settings?.driveLinked),
    driveLastBackupOn: isDate(raw.settings?.driveLastBackupOn) ? raw.settings.driveLastBackupOn : "",
    workerToken: clip(raw.settings?.workerToken, 200),
    pushOn: Boolean(raw.settings?.pushOn),
  };
  state.crystals = nonNegInt(raw.crystals);
  state.freezes = nonNegInt(raw.freezes);
  state.longest = nonNegInt(raw.longest);
  state.crystalLog = Array.isArray(raw.crystalLog)
    ? raw.crystalLog.slice(0, LIMITS.log).map((entry) => ({
        at: String(entry.at || new Date().toISOString()),
        delta: Number(entry.delta) || 0,
        reason: clip(entry.reason, 40) || "crystals",
      }))
    : [];
  state.freezeLog = Array.isArray(raw.freezeLog)
    ? raw.freezeLog
        .filter((entry) => isDate(entry?.date))
        .slice(0, 500)
        .map((entry) => ({ date: entry.date, at: String(entry.at || "") }))
    : [];
  state.ownedThemes = ["ember"];
  if (Array.isArray(raw.ownedThemes)) {
    for (const id of raw.ownedThemes) {
      if (THEMES.some((theme) => theme.id === id) && !state.ownedThemes.includes(id)) {
        state.ownedThemes.push(id);
      }
    }
  }
  const theme = raw.settings?.theme;
  if (state.ownedThemes.includes(theme)) state.settings.theme = theme;

  state.template = base.template;
  if (raw.template && typeof raw.template === "object") {
    for (let wd = 1; wd <= 7; wd += 1) {
      const source = raw.template[String(wd)] || raw.template[wd];
      if (!source) continue;
      state.template[String(wd)] = cleanSlots(source, false);
    }
  }

  state.days = {};
  const dayKeys = raw.days && typeof raw.days === "object" ? Object.keys(raw.days) : [];
  if (dayKeys.length > LIMITS.days) throw new Error("That backup has more days than Ember can hold.");
  for (const key of dayKeys) {
    if (!isDate(key)) continue;
    state.days[key] = { slots: cleanSlots(raw.days[key]?.slots || raw.days[key], true) };
  }

  state.workouts = [];
  if (Array.isArray(raw.workouts)) {
    if (raw.workouts.length > LIMITS.workouts) throw new Error("That backup has too many workouts.");
    for (const item of raw.workouts) {
      const workout = cleanWorkout(item);
      if (workout) state.workouts.push(workout);
    }
  }

  state.xpEvents = [];
  if (Array.isArray(raw.xpEvents)) {
    if (raw.xpEvents.length > LIMITS.events) throw new Error("That backup has too much history.");
    for (const event of raw.xpEvents) {
      if (!isDate(event?.date) || !event.ref) continue;
      const amount = Number(event.amount);
      if (!Number.isFinite(amount)) continue;
      state.xpEvents.push({
        id: clip(event.id, 80) || event.ref,
        at: String(event.at || new Date().toISOString()),
        date: event.date,
        amount,
        source: event.source === "workout" ? "workout" : "task",
        ref: clip(event.ref, 80),
      });
    }
  }

  state.grants = {};
  if (raw.grants && typeof raw.grants === "object") {
    for (const [key, value] of Object.entries(raw.grants)) {
      if (key.length > 80) continue;
      state.grants[key] = value === true ? true : clip(value, 40) || true;
    }
  }
  const level = levelFor(state.xpEvents.reduce((sum, event) => sum + event.amount, 0));
  for (let step = 2; step <= level; step += 1) {
    if (!state.grants[`level:${step}`]) state.grants[`level:${step}`] = "imported";
  }

  state.rivalDays = {};
  if (raw.rivalDays && typeof raw.rivalDays === "object") {
    const keys = Object.keys(raw.rivalDays).filter(isDate).slice(-120);
    for (const key of keys) state.rivalDays[key] = raw.rivalDays[key];
  }
  return state;
}

function cleanSlots(source, asTasks) {
  const slots = { morning: [], afternoon: [], evening: [] };
  if (!source || typeof source !== "object") return slots;
  for (const slot of SLOTS) {
    const list = Array.isArray(source[slot]) ? source[slot] : [];
    for (const item of list.slice(0, 12)) {
      const title = clip(item?.title, 80);
      if (!title) continue;
      const row = {
        id: clip(item.id, 80) || `imp-${slot}-${slots[slot].length}`,
        title,
        why: clip(item?.why, 160),
        time: validTime(item?.time),
      };
      if (asTasks) {
        row.done = Boolean(item.done);
        row.doneAt = item.doneAt ? String(item.doneAt) : null;
      }
      slots[slot].push(row);
    }
  }
  return slots;
}

function cleanWorkout(item) {
  const name = clip(item?.name, 60);
  const date = item?.date;
  if (!name || !isDate(date)) return null;
  const kind = item.kind === "cardio" ? "cardio" : "strength";
  return {
    id: clip(item.id, 80) || `wo-${date}-${name}`,
    date,
    name,
    kind,
    sets: kind === "strength" && Array.isArray(item.sets)
      ? item.sets.slice(0, 30).map((set) => ({
          reps: nonNegInt(set?.reps),
          weightKg: Math.max(0, Number(set?.weightKg) || 0),
        }))
      : [],
    durationMin: kind === "cardio" ? Math.max(0, Number(item.durationMin) || 0) : null,
    distanceKm: kind === "cardio" ? Math.max(0, Number(item.distanceKm) || 0) : null,
    notes: clip(item?.notes, 160),
    createdAt: String(item.createdAt || new Date().toISOString()),
  };
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function nonNegInt(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
