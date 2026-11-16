import { levelFor } from "./economy.js";
import { DEFAULT_PUSHUP_MAX, DEFAULT_UNLOCK_MINUTES, clampPushupMax, clampUnlockMinutes } from "./pushups.js";
import { uid } from "./format.js";
import { applyXpPenalty } from "./penalty.js";
import { isFullDay, tasksOn } from "./stats.js";
import { totalXp } from "./stats.js";
import { dateKey, minuteOfDay, weekdayIso, zonedTimeToUtc } from "./time.js";
import { unit } from "./rivals.js";

export const CHALLENGE_DEADLINE_MS = 30 * 60 * 1000;
export const CHALLENGE_MISS_XP = 25;
export const ROLL_MIN_MS = 45 * 60 * 1000;
export const ROLL_MAX_MS = 75 * 60 * 1000;

export const DEFAULT_QUIET_SCHOOL = {
  on: true,
  start: "06:35",
  end: "16:00",
  weekdays: [1, 2, 3, 4, 5],
};

export const DEFAULT_QUIET_NIGHT = {
  on: true,
  start: "22:00",
  end: "06:20",
};

export const CHALLENGE_TYPES = [
  { id: "pushups", label: "Push-ups", base: 10 },
  { id: "squats", label: "Squats", base: 12 },
  { id: "burpees", label: "Burpees", base: 6 },
  { id: "plank", label: "Plank (seconds)", base: 45, isSeconds: true },
  { id: "jumping-jacks", label: "Jumping jacks", base: 20 },
  { id: "lunges", label: "Lunges (each leg)", base: 10 },
];

function parseClock(text) {
  const match = String(text || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function mergeQuiet(settings) {
  return {
    school: { ...DEFAULT_QUIET_SCHOOL, ...(settings?.quietSchool || {}) },
    night: { ...DEFAULT_QUIET_NIGHT, ...(settings?.quietNight || {}) },
  };
}

function inSpan(minute, start, end) {
  if (start == null || end == null) return false;
  if (start <= end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** True when Stockholm civil time sits inside school or night quiet windows. */
export function isQuietHour(now, settings) {
  const quiet = mergeQuiet(settings || {});
  const minute = minuteOfDay(now);
  const today = dateKey(now);
  const wd = weekdayIso(today);
  if (quiet.school.on && (quiet.school.weekdays || DEFAULT_QUIET_SCHOOL.weekdays).includes(wd)) {
    const start = parseClock(quiet.school.start);
    const end = parseClock(quiet.school.end);
    if (inSpan(minute, start, end)) return true;
  }
  if (quiet.night.on) {
    const start = parseClock(quiet.night.start);
    const end = parseClock(quiet.night.end);
    if (inSpan(minute, start, end)) return true;
  }
  return false;
}

/** Next instant (ms) when quiet hours end; if not quiet, returns `now`. */
export function quietEndsAt(now, settings) {
  if (!isQuietHour(now, settings)) return now.getTime();
  const quiet = mergeQuiet(settings || {});
  const minute = minuteOfDay(now);
  const today = dateKey(now);
  const wd = weekdayIso(today);
  const candidates = [];
  if (quiet.school.on && (quiet.school.weekdays || DEFAULT_QUIET_SCHOOL.weekdays).includes(wd)) {
    const end = parseClock(quiet.school.end);
    if (end != null && inSpan(minute, parseClock(quiet.school.start), end)) {
      candidates.push(zonedTimeToUtc(today, `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`));
    }
  }
  if (quiet.night.on) {
    const start = parseClock(quiet.night.start);
    const end = parseClock(quiet.night.end);
    if (end != null && inSpan(minute, start, end)) {
      const endKey = end < (start || 0) && minute >= (start || 0) ? addDayKey(today, 1) : today;
      candidates.push(
        zonedTimeToUtc(endKey, `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`),
      );
    }
  }
  if (!candidates.length) return now.getTime();
  return Math.min(...candidates.filter((t) => t > now.getTime()));
}

function addDayKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + n));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function defaultChallengeSettings() {
  return {
    challengesOn: true,
    blockMode: "pushups",
    unlockMinutes: DEFAULT_UNLOCK_MINUTES,
    pushupMax: DEFAULT_PUSHUP_MAX,
    quietSchool: { ...DEFAULT_QUIET_SCHOOL },
    quietNight: { ...DEFAULT_QUIET_NIGHT },
    blockedPackages: [],
  };
}

export function ensureChallengeState(state) {
  if (!state.challenges || typeof state.challenges !== "object") {
    state.challenges = {
      current: null,
      nextRollAt: null,
      difficultyStep: 0,
      processedInbox: [],
    };
  }
  if (!Array.isArray(state.challenges.processedInbox)) state.challenges.processedInbox = [];
  if (state.challenges.difficultyStep == null) state.challenges.difficultyStep = 0;
  if (!Array.isArray(state.challengeInbox)) state.challengeInbox = [];
  return state;
}

export function repsForChallenge(type, difficulty) {
  const d = Math.max(1, Math.min(6, Number(difficulty) || 1));
  const scale = 0.75 + d * 0.22;
  const raw = Math.round(type.base * scale);
  return Math.max(type.isSeconds ? 20 : 3, raw);
}

export function pickChallenge(seed, difficultyStep = 0) {
  const difficulty = Math.max(1, Math.min(6, 1 + Math.max(0, Number(difficultyStep) || 0)));
  const idx = Math.floor(unit(`ch:${seed}:pick`) * CHALLENGE_TYPES.length);
  const type = CHALLENGE_TYPES[idx];
  const reps = repsForChallenge(type, difficulty);
  return {
    id: uid(),
    typeId: type.id,
    label: type.label,
    reps,
    difficulty,
    isSeconds: Boolean(type.isSeconds),
  };
}

export function rollIntervalMs(seed) {
  const span = ROLL_MAX_MS - ROLL_MIN_MS;
  return ROLL_MIN_MS + Math.floor(unit(`ch:${seed}:roll`) * span);
}

function scheduleNextRoll(state, now, seed) {
  let at = now.getTime() + rollIntervalMs(seed || now.toISOString());
  if (isQuietHour(now, state.settings)) {
    at = Math.max(at, quietEndsAt(now, state.settings));
  } else {
    const probe = new Date(at);
    if (isQuietHour(probe, state.settings)) {
      at = quietEndsAt(probe, state.settings);
    }
  }
  state.challenges.nextRollAt = new Date(at).toISOString();
}

export function openChallenge(state, now, seed) {
  ensureChallengeState(state);
  const picked = pickChallenge(seed || now.toISOString(), state.challenges.difficultyStep);
  const openedAt = now.toISOString();
  const deadlineAt = new Date(now.getTime() + CHALLENGE_DEADLINE_MS).toISOString();
  state.challenges.current = {
    ...picked,
    openedAt,
    deadlineAt,
    quietCancelled: false,
  };
  return picked;
}

export function cancelChallengeQuiet(state) {
  ensureChallengeState(state);
  if (!state.challenges.current) return false;
  state.challenges.current = null;
  return true;
}

export function confirmChallenge(state, now) {
  ensureChallengeState(state);
  const current = state.challenges.current;
  if (!current) return false;
  state.challenges.processedInbox.push(current.id);
  state.challenges.current = null;
  state.challenges.difficultyStep = 0;
  scheduleNextRoll(state, now, current.id);
  return true;
}

export function resolveChallengeMiss(state, now, refId) {
  ensureChallengeState(state);
  const current = state.challenges.current;
  const id = refId || current?.id;
  if (!id) return false;
  if (state.challenges.processedInbox.includes(id)) return false;
  applyXpPenalty(state, CHALLENGE_MISS_XP, `challenge-miss:${id}`, now);
  state.challenges.processedInbox.push(id);
  state.challenges.difficultyStep = Math.min(4, (Number(state.challenges.difficultyStep) || 0) + 1);
  state.challenges.current = null;
  scheduleNextRoll(state, now, id);
  return true;
}

/** Quest-only full day for app-unlock eligibility. */
export function isFullDayQuests(state, date) {
  const tasks = tasksOn(state, date).filter((task) => !task.isEvent);
  return tasks.length > 0 && tasks.every((task) => task.done);
}

export function challengesLocked(state, today) {
  if (!state.settings?.challengesOn) return true;
  return !isFullDayQuests(state, today);
}

export function applyChallengeInbox(state, now = new Date()) {
  ensureChallengeState(state);
  const inbox = Array.isArray(state.challengeInbox) ? state.challengeInbox : [];
  if (!inbox.length) return state;
  const rest = [];
  for (const event of inbox) {
    if (!event || typeof event !== "object") continue;
  const key = String(event.challengeId || event.id || "");
    if (event.type === "miss" && key) {
      if (!state.challenges.processedInbox.includes(key)) {
        resolveChallengeMiss(state, now, key);
      }
    } else if (event.type === "pushup-unlock" || event.type === "pushup-max") {
      const pkg = String(event.package || "").slice(0, 120);
      const until = String(event.until || "");
      if (event.type === "pushup-unlock" && pkg && until) {
        state.appUnlocks = { ...(state.appUnlocks || {}), [pkg]: until };
      }
      const raised = Math.round(Number(event.max));
      const reps = Math.round(Number(event.reps));
      const nextMax = Math.max(
        Number.isFinite(raised) ? raised : 0,
        Number.isFinite(reps) ? reps : 0,
      );
      if (event.type === "pushup-max" && nextMax > (Number(state.settings?.pushupMax) || 0)) {
        state.settings = state.settings || {};
        state.settings.pushupMax = clampPushupMax(nextMax);
      }
    } else if (event.type === "reward-unlock") {
      const until = String(event.until || "");
      if (Date.parse(until) > now.getTime()) {
        state.rewardUnlock = {
          title: String(state.rewardUnlock?.title || "").slice(0, 60),
          minutes: Math.max(0, Math.round(Number(event.minutes) || 0)),
          ...(state.rewardUnlock || {}),
          until,
        };
      }
    } else if (event.type === "unlock" || event.type === "native-roll") {
      /* native wake; prepare/processChallenges runs on resume */
    } else {
      rest.push(event);
    }
  }
  state.challengeInbox = rest;
  return state;
}

export function processChallenges(state, now = new Date()) {
  ensureChallengeState(state);
  if (!state.settings?.challengesOn) return { state, events: [] };
  const events = [];
  applyChallengeInbox(state, now);

  if (!state.challenges.nextRollAt) {
    scheduleNextRoll(state, now, state.startedOn || dateKey(now));
  }

  const current = state.challenges.current;
  if (current) {
    const deadline = new Date(current.deadlineAt).getTime();
    if (isQuietHour(now, state.settings)) {
      if (cancelChallengeQuiet(state)) events.push({ type: "quiet-cancel" });
    } else if (now.getTime() >= deadline) {
      if (resolveChallengeMiss(state, now, current.id)) events.push({ type: "miss", id: current.id });
    }
  } else {
    const rollAt = new Date(state.challenges.nextRollAt).getTime();
    if (now.getTime() >= rollAt) {
      if (isQuietHour(now, state.settings)) {
        state.challenges.nextRollAt = new Date(quietEndsAt(now, state.settings)).toISOString();
        events.push({ type: "roll-delayed-quiet" });
      } else if (challengesLocked(state, dateKey(now))) {
        scheduleNextRoll(state, now, `locked:${rollAt}`);
        events.push({ type: "roll-delayed-lock" });
      } else {
        openChallenge(state, now, `roll:${rollAt}`);
        events.push({ type: "opened", id: state.challenges.current?.id });
      }
    }
  }

  return { state, events };
}

export function challengeSnapshot(state, now = new Date()) {
  ensureChallengeState(state);
  const current = state.challenges.current;
  const quiet = isQuietHour(now, state.settings);
  const locked = challengesLocked(state, dateKey(now));
  return {
    locked,
    quiet,
    challengeActive: Boolean(current),
    challengeDeadline: current?.deadlineAt || null,
    difficulty: current?.difficulty || 1 + (state.challenges.difficultyStep || 0),
    packages: state.settings?.blockedPackages || [],
    current,
    nextRollAt: state.challenges.nextRollAt,
    msRemaining: current ? Math.max(0, new Date(current.deadlineAt).getTime() - now.getTime()) : 0,
  };
}

export function foldChallengesIntoPrepare(state, now) {
  applyChallengeInbox(state, now);
  return processChallenges(state, now).state;
}

export function normalizeQuietSchool(raw) {
  const base = { ...DEFAULT_QUIET_SCHOOL };
  if (!raw || typeof raw !== "object") return base;
  return {
    on: raw.on !== false,
    start: parseClock(raw.start) != null ? String(raw.start).slice(0, 5) : base.start,
    end: parseClock(raw.end) != null ? String(raw.end).slice(0, 5) : base.end,
    weekdays: Array.isArray(raw.weekdays)
      ? raw.weekdays.map((n) => Number(n)).filter((n) => n >= 1 && n <= 7)
      : base.weekdays,
  };
}

export function normalizeQuietNight(raw) {
  const base = { ...DEFAULT_QUIET_NIGHT };
  if (!raw || typeof raw !== "object") return base;
  return {
    on: raw.on !== false,
    start: parseClock(raw.start) != null ? String(raw.start).slice(0, 5) : base.start,
    end: parseClock(raw.end) != null ? String(raw.end).slice(0, 5) : base.end,
  };
}

export function playerDifficultyStep(state) {
  return Math.max(0, Number(state.challenges?.difficultyStep) || 0);
}

export function challengeLevel(state) {
  return levelFor(totalXp(state));
}