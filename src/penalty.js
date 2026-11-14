import { LEVEL_START, SLOTS, XP_TASK } from "./constants.js";
import { levelFor } from "./economy.js";
import { uid } from "./format.js";
import { addDays, dateKey, isWeekend } from "./time.js";
import { doneCount, isComplete, isFullDay, taskCount, totalXp } from "./stats.js";

export const XP_PENALTY_PER_QUEST = 15;
export const FREEZE_REFUND_CRYSTALS = 16;
export const PENALTY_TAG = "penalty";

const PENALTY_POOL = [
  { title: "Penalty: 30 push-ups", why: "The System does not accept empty days.", time: "07:30" },
  { title: "Penalty: cold shower 2 minutes", why: "Reset. Then move.", time: "07:45" },
  { title: "Penalty: 20-minute walk", why: "No excuses. Out the door.", time: "16:00" },
  { title: "Penalty: plank 3×45 sec", why: "Core tax for a missed day.", time: "18:00" },
  { title: "Penalty: review yesterday on paper", why: "Name what failed. Fix one thing.", time: "21:00" },
];

function blankSlots() {
  return { morning: [], afternoon: [], evening: [] };
}

/** Days strictly before today that broke the streak (no quests done). */
export function missedDatesBefore(state, today) {
  const since = state.penaltySince || state.startedOn || today;
  const missed = [];
  let cursor = addDays(today, -1);
  for (let i = 0; i < 21; i += 1) {
    if (cursor < since) return missed.reverse();
    if (isComplete(state, cursor)) return missed.reverse();
    if (taskCount(state, cursor) > 0) missed.push(cursor);
    else if (cursor < (state.startedOn || today)) return missed.reverse();
    cursor = addDays(cursor, -1);
  }
  return missed.reverse();
}

function xpFloorForLevel(level) {
  const idx = Math.max(0, Math.min(LEVEL_START.length - 1, level - 1));
  return LEVEL_START[idx] || 0;
}

/** Remove XP down to floor for current level and 0 minimum total display logic. */
export function applyXpPenalty(state, amount, ref, now) {
  const loss = Math.max(0, Math.round(Number(amount) || 0));
  if (!loss) return 0;
  const before = totalXp(state);
  const level = levelFor(before);
  const floor = xpFloorForLevel(level);
  const maxLoss = Math.max(0, before - floor);
  const applied = Math.min(loss, maxLoss);
  if (!applied) return 0;
  state.xpEvents.push({
    id: uid(),
    at: now.toISOString(),
    date: dateKey(now),
    amount: -applied,
    source: "penalty",
    ref,
  });
  return applied;
}

function pickPenaltyQuest(date) {
  const idx = Math.abs(hashDate(date)) % PENALTY_POOL.length;
  return PENALTY_POOL[idx];
}

function hashDate(date) {
  let h = 0;
  for (let i = 0; i < date.length; i += 1) h = (h * 31 + date.charCodeAt(i)) | 0;
  return h;
}

export function hasOpenPenaltyQuest(state, date) {
  const day = state.days?.[date];
  if (!day) return false;
  for (const slot of SLOTS) {
    for (const task of day.slots?.[slot] || []) {
      if (task.penaltyTag === PENALTY_TAG && !task.done) return true;
    }
  }
  return false;
}

export function injectPenaltyQuest(state, date) {
  if (!state.days[date]) state.days[date] = { slots: blankSlots() };
  if (hasOpenPenaltyQuest(state, date)) return false;
  const spec = pickPenaltyQuest(date);
  const task = {
    id: uid(),
    title: spec.title,
    why: spec.why,
    time: spec.time,
    isEvent: false,
    done: false,
    doneAt: null,
    penaltyTag: PENALTY_TAG,
  };
  state.days[date].slots.morning.unshift(task);
  return true;
}

/**
 * Run once per app open / settle. Processes newly discovered missed days since last penalty cursor.
 * Returns report for UI if anything new happened today.
 */
export function processPenalties(state, today, now) {
  const processed = new Set(Array.isArray(state.penaltyProcessed) ? state.penaltyProcessed : []);
  const since = state.penaltySince || today;
  const pending = missedDatesBefore(state, today).filter((d) => !processed.has(d));
  for (const date of pending) {
    if (date < since) processed.add(date);
  }
  const missed = pending.filter((d) => d >= since);
  state.penaltyProcessed = [...processed].slice(-120);
  if (!missed.length) {
    return { state, report: null, fresh: false };
  }

  let xpLost = 0;
  let questsMissed = 0;
  const dates = [];

  for (const date of missed) {
    const total = taskCount(state, date);
    const done = doneCount(state, date);
    const incomplete = Math.max(0, total - done);
  if (total === 0) {
      processed.add(date);
      continue;
    }
    dates.push(date);
    questsMissed += incomplete;
    const loss = incomplete * XP_PENALTY_PER_QUEST;
    xpLost += applyXpPenalty(state, loss, `miss:${date}`, now);
    processed.add(date);
  }

  state.streakBrokenAt = today;
  state.crystalStress = Math.min(1, (Number(state.crystalStress) || 0) + 0.35 * missed.length);

  const report = {
    id: uid(),
    at: now.toISOString(),
    dates,
    questsMissed,
    xpLost,
    streakReset: true,
  };

  state.lastPenaltyReport = report;
  state.penaltyReports = [report, ...(state.penaltyReports || [])].slice(0, 20);

  injectPenaltyQuest(state, today);

  return { state, report, fresh: true };
}

export function clearPenaltyReport(state) {
  state.lastPenaltyReport = null;
  return state;
}

export function mintsLeftToday(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const bag = {};
  for (const p of parts) if (p.type !== "literal") bag[p.type] = p.value;
  const h = Number(bag.hour === "24" ? 0 : bag.hour);
  const m = Number(bag.minute);
  const s = Number(bag.second);
  return Math.max(0, 24 * 3600 - (h * 3600 + m * 60 + s));
}

export function formatTimeLeft(seconds) {
  const sec = Math.max(0, Math.round(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export function todayUrgency(state, date, now) {
  const left = Math.max(0, taskCount(state, date) - doneCount(state, date));
  const timeLeft = formatTimeLeft(mintsLeftToday(now));
  const full = isFullDay(state, date);
  return { left, timeLeft, full, weekend: isWeekend(date) };
}