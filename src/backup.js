import { SLOTS, THEMES, XP_TASK, XP_WORKOUT } from "./constants.js";
import { createInitialState, validTime } from "./domain.js";
import { levelFor } from "./economy.js";
import { defaultChallengeSettings, ensureChallengeState, normalizeQuietNight, normalizeQuietSchool } from "./challenges.js";
import { migrateStateV2 } from "./migrate.js";
import { totalXp } from "./stats.js";

const LIMITS = {
  days: 8000,
  perSlot: 200,
  workouts: 10000,
  sets: 200,
  events: 50000,
  log: 500,
  rivalDays: 400,
  rewards: 80,
};

export function parseBackupText(text) {
  const cleaned = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) throw new Error("That backup file is empty.");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
}

export function summarizeBackup(state) {
  let quests = 0;
  for (const day of Object.values(state?.days || {})) {
    for (const slot of SLOTS) quests += (day?.slots?.[slot] || []).length;
  }
  const workouts = (state?.workouts || []).length;
  const xp = totalXp(state || {});
  const level = levelFor(xp);
  return {
    quests,
    workouts,
    xp,
    level,
    crystals: Number(state?.crystals) || 0,
  };
}

export function formatRestoreSummary(state) {
  const { quests, workouts, level } = summarizeBackup(state);
  return `Restored ${quests} quest${quests === 1 ? "" : "s"}, ${workouts} workout${workouts === 1 ? "" : "s"}, level ${level}`;
}

/**
 * Validate and migrate any v1 backup (including pre-c5154ec exports from a911006).
 * When `current` is passed during an interactive import, device-local fields introduced
 * after a911006 (`workerToken`, `pushOn`, `driveLinked`, `driveLastBackupOn`) are kept if
 * the older backup file did not define them.
 */
export function sanitizeImport(raw, current = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("That file isn't an Ember backup.");
  }
  if (raw.version != null && Number(raw.version) !== 1) {
    throw new Error("This backup is from a different Ember version.");
  }
  const size = JSON.stringify(raw).length;
  if (size > 12_000_000) throw new Error("That backup is too large for this phone.");

  const base = createInitialState(new Date());
  const state = base;
  const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const prevSettings = current?.settings && typeof current.settings === "object" ? current.settings : {};

  state.startedOn = normalizeDate(raw.startedOn) || base.startedOn;

  const importedGeminiKey = clip(rawSettings.geminiApiKey, 200) || clip(prevSettings.geminiApiKey, 200);
  const importedKeyStatus = clip(rawSettings.geminiKeyStatus, 20)
    || (!clip(rawSettings.geminiApiKey, 200) && prevSettings.geminiApiKey ? clip(prevSettings.geminiKeyStatus, 20) : "");

  state.settings = {
    geminiApiKey: importedGeminiKey,
    goals: typeof rawSettings.goals === "string" ? clip(rawSettings.goals, 2000) : base.settings.goals,
    theme: "frost",
    sound: rawSettings.sound !== false,
    soundVolume: Math.max(0, Math.min(1, Number(rawSettings.soundVolume) || 0.72)),
    crystalSkin: clip(rawSettings.crystalSkin, 24) || "default",
    checkFx: clip(rawSettings.checkFx, 24) || "shards",
    soundPack: clip(rawSettings.soundPack, 24) || "system",
    equippedTitle: clip(rawSettings.equippedTitle, 40),
    haptics: rawSettings.haptics !== false,
    doneSlotsOpen:
      rawSettings.doneSlotsOpen && typeof rawSettings.doneSlotsOpen === "object" ? rawSettings.doneSlotsOpen : {},
    dismissedHint: Boolean(rawSettings.dismissedHint),
    geminiKeyStatus: importedGeminiKey ? importedKeyStatus : "",
    driveLinked: "driveLinked" in rawSettings ? Boolean(rawSettings.driveLinked) : Boolean(prevSettings.driveLinked),
    driveAutoBackup: "driveAutoBackup" in rawSettings
      ? rawSettings.driveAutoBackup !== false
      : (prevSettings.driveAutoBackup !== false),
    driveLastBackupOn: "driveLastBackupOn" in rawSettings
      ? (normalizeDate(rawSettings.driveLastBackupOn) || "")
      : (normalizeDate(prevSettings.driveLastBackupOn) || ""),
    driveLastBackupAt: "driveLastBackupAt" in rawSettings
      ? normalizeIso(rawSettings.driveLastBackupAt)
      : normalizeIso(prevSettings.driveLastBackupAt),
    workerToken: "workerToken" in rawSettings ? clip(rawSettings.workerToken, 200) : clip(prevSettings.workerToken, 200),
    pushOn: "pushOn" in rawSettings ? Boolean(rawSettings.pushOn) : Boolean(prevSettings.pushOn),
    challengesOn:
      "challengesOn" in rawSettings ? rawSettings.challengesOn !== false : prevSettings.challengesOn !== false,
    quietSchool: normalizeQuietSchool(
      "quietSchool" in rawSettings ? rawSettings.quietSchool : prevSettings.quietSchool,
    ),
    quietNight: normalizeQuietNight("quietNight" in rawSettings ? rawSettings.quietNight : prevSettings.quietNight),
    blockedPackages: Array.isArray(rawSettings.blockedPackages)
      ? rawSettings.blockedPackages.map((pkg) => clip(pkg, 120)).filter(Boolean).slice(0, 64)
      : Array.isArray(prevSettings.blockedPackages)
        ? prevSettings.blockedPackages
        : defaultChallengeSettings().blockedPackages,
  };

  state.crystals = nonNegInt(raw.crystals);
  state.freezes = nonNegInt(raw.freezes);
  state.longest = nonNegInt(raw.longest);
  state.crystalStress = Math.max(0, Math.min(1, Number(raw.crystalStress) || 0));
  state.crystalLog = Array.isArray(raw.crystalLog)
    ? raw.crystalLog.slice(0, LIMITS.log).map((entry) => ({
        at: String(entry?.at || new Date().toISOString()),
        delta: Number(entry?.delta) || 0,
        reason: clip(entry?.reason, 40) || "crystals",
      }))
    : [];
  state.ownedThemes = ["ember", "frost"];
  if (Array.isArray(raw.ownedThemes)) {
    for (const id of raw.ownedThemes) {
      if (THEMES.some((theme) => theme.id === id) && !state.ownedThemes.includes(id)) {
        state.ownedThemes.push(id);
      }
    }
  }
  const theme = rawSettings.theme;
  if (THEMES.some((item) => item.id === theme) && state.ownedThemes.includes(theme)) {
    state.settings.theme = theme;
  } else if (!state.ownedThemes.includes(state.settings.theme)) {
    state.settings.theme = state.ownedThemes.includes("frost") ? "frost" : "ember";
  }

  state.ownedSkins = ["default"];
  if (Array.isArray(raw.ownedSkins)) {
    for (const id of raw.ownedSkins) {
      const key = clip(id, 24);
      if (key && !state.ownedSkins.includes(key)) state.ownedSkins.push(key);
    }
  }
  state.ownedTitles = Array.isArray(raw.ownedTitles) ? raw.ownedTitles.map((id) => clip(id, 24)).filter(Boolean).slice(0, 40) : [];
  state.ownedBadges = Array.isArray(raw.ownedBadges) ? raw.ownedBadges.map((id) => clip(id, 24)).filter(Boolean).slice(0, 40) : [];
  state.ownedFx = ["shards"];
  if (Array.isArray(raw.ownedFx)) {
    for (const id of raw.ownedFx) {
      const key = clip(id, 24);
      if (key && !state.ownedFx.includes(key)) state.ownedFx.push(key);
    }
  }
  state.ownedSoundPacks = ["system"];
  if (Array.isArray(raw.ownedSoundPacks)) {
    for (const id of raw.ownedSoundPacks) {
      const key = clip(id, 24);
      if (key && !state.ownedSoundPacks.includes(key)) state.ownedSoundPacks.push(key);
    }
  }
  state.customRewards = Array.isArray(raw.customRewards)
    ? raw.customRewards
        .slice(0, LIMITS.rewards)
        .map((item) => ({
          id: clip(item?.id, 80) || `life-${Math.random().toString(36).slice(2, 8)}`,
          title: clip(item?.title, 60),
          price: Math.max(1, Math.min(999, Math.round(Number(item?.price) || 0))),
          createdAt: normalizeIso(item?.createdAt) || new Date().toISOString(),
        }))
        .filter((item) => item.title)
    : [];
  state.penaltyProcessed = Array.isArray(raw.penaltyProcessed)
    ? raw.penaltyProcessed.map((d) => normalizeDate(d)).filter(Boolean).slice(0, 120)
    : [];
  state.penaltyReports = Array.isArray(raw.penaltyReports) ? raw.penaltyReports.slice(0, 20) : [];
  state.lastPenaltyReport = raw.lastPenaltyReport && typeof raw.lastPenaltyReport === "object" ? raw.lastPenaltyReport : null;
  const importedSince = normalizeDate(raw.penaltySince);
  if (importedSince) state.penaltySince = importedSince;

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
  for (const rawKey of dayKeys) {
    const key = normalizeDate(rawKey);
    if (!key) continue;
    state.days[key] = { slots: cleanSlots(raw.days[rawKey]?.slots || raw.days[rawKey], true, key) };
  }

  state.workouts = [];
  if (Array.isArray(raw.workouts)) {
    if (raw.workouts.length > LIMITS.workouts) throw new Error("That backup has too many workouts.");
    for (let i = 0; i < raw.workouts.length; i += 1) {
      const workout = cleanWorkout(raw.workouts[i], i);
      if (workout) state.workouts.push(workout);
    }
  }

  state.xpEvents = [];
  if (Array.isArray(raw.xpEvents)) {
    if (raw.xpEvents.length > LIMITS.events) throw new Error("That backup has too much history.");
    for (let i = 0; i < raw.xpEvents.length; i += 1) {
      const event = raw.xpEvents[i];
      const date = normalizeDate(event?.date) || normalizeDate(event?.at);
      if (!date) continue;
      const amount = Number(event?.amount);
      if (!Number.isFinite(amount)) continue;
      const source = event?.source === "workout" ? "workout" : "task";
      const ref = clip(event?.ref || event?.id, 80) || `imp-xp-${date}-${i}`;
      state.xpEvents.push({
        id: clip(event?.id, 80) || ref,
        at: String(event?.at || `${date}T12:00:00.000Z`),
        date,
        amount,
        source,
        ref,
      });
    }
  }

  reconcileMissingXp(state);

  const earliestDate = Object.keys(state.days).sort()[0];
  if (earliestDate && earliestDate < state.startedOn) state.startedOn = earliestDate;

  state.grants = {};
  if (raw.grants && typeof raw.grants === "object") {
    for (const [key, value] of Object.entries(raw.grants)) {
      if (!value || key.length > 80) continue;
      state.grants[key] = value === true ? true : clip(value, 40) || true;
    }
  }
  const level = levelFor(state.xpEvents.reduce((sum, event) => sum + event.amount, 0));
  for (let step = 2; step <= level; step += 1) {
    if (!state.grants[`level:${step}`]) state.grants[`level:${step}`] = "imported";
  }

  state.rivalDays = {};
  if (raw.rivalDays && typeof raw.rivalDays === "object") {
    const entries = [];
    for (const rawKey of Object.keys(raw.rivalDays)) {
      const key = normalizeDate(rawKey);
      const value = raw.rivalDays[rawKey];
      if (key && value && typeof value === "object") entries.push([key, value]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [key, value] of entries.slice(-LIMITS.rivalDays)) {
      state.rivalDays[key] = value;
    }
  }
  state.challenges = {
    current: null,
    nextRollAt: null,
    difficultyStep: 0,
    processedInbox: [],
  };
  state.challengeInbox = [];
  if (raw.challenges && typeof raw.challenges === "object") {
    const ch = raw.challenges;
    if (ch.current && typeof ch.current === "object") {
      state.challenges.current = {
        id: clip(ch.current.id, 80) || `ch-${Date.now()}`,
        typeId: clip(ch.current.typeId, 40) || "pushups",
        label: clip(ch.current.label, 60) || "Push-ups",
        reps: Math.max(1, Math.round(Number(ch.current.reps) || 10)),
        difficulty: Math.max(1, Math.round(Number(ch.current.difficulty) || 1)),
        openedAt: normalizeIso(ch.current.openedAt),
        deadlineAt: normalizeIso(ch.current.deadlineAt),
        isSeconds: Boolean(ch.current.isSeconds),
      };
    }
    state.challenges.nextRollAt = normalizeIso(ch.nextRollAt) || null;
    state.challenges.difficultyStep = Math.max(0, Math.round(Number(ch.difficultyStep) || 0));
    state.challenges.processedInbox = Array.isArray(ch.processedInbox)
      ? ch.processedInbox.map((id) => clip(id, 80)).filter(Boolean).slice(0, 200)
      : [];
  }
  if (Array.isArray(raw.challengeInbox)) {
    state.challengeInbox = raw.challengeInbox.slice(0, 40);
  }
  ensureChallengeState(state);

  state.rivalXp = {};
  if (raw.rivalXp && typeof raw.rivalXp === "object") {
    for (const [id, amount] of Object.entries(raw.rivalXp)) {
      const key = clip(id, 24);
      if (!key) continue;
      const val = Math.max(0, Math.round(Number(amount) || 0));
      state.rivalXp[key] = val;
    }
  }
  state.rivalSimAt = normalizeIso(raw.rivalSimAt) || null;
  return migrateStateV2(state, new Date());
}

function reconcileMissingXp(state) {
  const seen = new Set(state.xpEvents.map((event) => `${event.source}:${event.ref}`));
  for (const [date, day] of Object.entries(state.days)) {
    for (const slot of SLOTS) {
      for (const task of day?.slots?.[slot] || []) {
        if (!task.done) continue;
        const key = `task:${task.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        state.xpEvents.push({
          id: `xp-${task.id}`,
          at: task.doneAt || `${date}T12:00:00.000Z`,
          date,
          amount: XP_TASK,
          source: "task",
          ref: task.id,
        });
      }
    }
  }
  for (const workout of state.workouts) {
    const key = `workout:${workout.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.xpEvents.push({
      id: `xp-${workout.id}`,
      at: workout.createdAt || `${workout.date}T12:00:00.000Z`,
      date: workout.date,
      amount: XP_WORKOUT,
      source: "workout",
      ref: workout.id,
    });
  }
}

function cleanSlots(source, asTasks, datePrefix = "tpl") {
  const slots = { morning: [], afternoon: [], evening: [] };
  if (!source || typeof source !== "object") return slots;
  for (const slot of SLOTS) {
    const list = Array.isArray(source[slot]) ? source[slot] : [];
    for (const item of list.slice(0, LIMITS.perSlot)) {
      const title = clip(item?.title, 80);
      if (!title) continue;
      const row = {
        id: clip(item?.id, 80) || `imp-${datePrefix}-${slot}-${slots[slot].length}`,
        title,
        why: clip(item?.why, 160),
        time: validTime(item?.time),
      };
      if (asTasks) {
        row.isEvent = Boolean(item?.isEvent);
        row.penaltyTag = clip(item?.penaltyTag, 16) || undefined;
        row.done = Boolean(item?.done);
        row.doneAt = item?.doneAt ? String(item.doneAt) : null;
      }
      slots[slot].push(row);
    }
  }
  return slots;
}

function cleanWorkout(item, index = 0) {
  const name = clip(item?.name, 60);
  const date = normalizeDate(item?.date) || normalizeDate(item?.createdAt);
  if (!name || !date) return null;
  const kind = item?.kind === "cardio" ? "cardio" : "strength";
  return {
    id: clip(item?.id, 80) || `wo-${date}-${index}-${name}`,
    date,
    name,
    kind,
    sets: kind === "strength" && Array.isArray(item?.sets)
      ? item.sets.slice(0, LIMITS.sets).map((set) => ({
          reps: nonNegInt(set?.reps),
          weightKg: Math.max(0, Number(set?.weightKg ?? set?.weight) || 0),
        }))
      : [],
    durationMin: kind === "cardio" ? Math.max(0, Number(item?.durationMin ?? item?.minutes) || 0) : null,
    distanceKm: kind === "cardio" ? Math.max(0, Number(item?.distanceKm ?? item?.km) || 0) : null,
    notes: clip(item?.notes, 160),
    createdAt: String(item?.createdAt || `${date}T12:00:00.000Z`),
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

function normalizeIso(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
}

function normalizeDate(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function backupFileShareable(file, nav = globalThis.navigator) {
  try {
    return !!(nav?.share && nav?.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

export async function saveBackupFile(jsonText, filename) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });
  if (backupFileShareable(file)) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { ok: true, method: "share" };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, cancelled: true };
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
  return { ok: true, method: "download" };
}
