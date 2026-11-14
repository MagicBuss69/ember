import { SLOTS } from "./constants.js";
import { LEVEL_START, levelFor } from "./economy.js";
import { uid } from "./format.js";
import { addDays, dateKey } from "./time.js";
import { doneCount, isComplete, isFullDay, taskCount, totalXp } from "./stats.js";

export const XP_PENALTY_PER_QUEST = 15;
export const FREEZE_REFUND_CRYSTALS = 16;
export const PENALTY_TAG = "must-do";

/** Varied must-do penalties (deterministic picks). difficulty: 1 easy, 2 medium, 3 hard. */
export const PENALTY_CATALOG = [
  { title: "Must-do: 20 push-ups", why: "The System does not accept empty days.", time: "07:30", difficulty: 1 },
  { title: "Must-do: 10-minute room tidy", why: "Reset the space before you reset the day.", time: "08:00", difficulty: 1 },
  { title: "Must-do: no phone for 1 hour", why: "One hour without the feed.", time: "09:00", difficulty: 1 },
  { title: "Must-do: 15-minute walk", why: "Out the door. No excuses.", time: "16:00", difficulty: 1 },
  { title: "Must-do: write 3 sentences on what failed", why: "Name it on paper.", time: "21:00", difficulty: 1 },
  { title: "Must-do: 50 push-ups", why: "More reps for a broken streak.", time: "07:15", difficulty: 2 },
  { title: "Must-do: 30-minute deep tidy", why: "One room, actually finished.", time: "17:00", difficulty: 2 },
  { title: "Must-do: no phone until bedtime", why: "The scroll ends at sundown.", time: "20:00", difficulty: 2 },
  { title: "Must-do: 30-minute jog or brisk walk", why: "Legs earn the day back.", time: "18:00", difficulty: 2 },
  { title: "Must-do: cold shower 2 minutes", why: "Reset the nervous system.", time: "07:45", difficulty: 2 },
  { title: "Must-do: 100 push-ups", why: "Hard tax for multiple misses.", time: "06:45", difficulty: 3 },
  { title: "Must-do: 5 km run or walk", why: "Distance before excuses.", time: "17:30", difficulty: 3 },
  { title: "Must-do: 2 hours deep work", why: "No tabs. One hard thing.", time: "14:00", difficulty: 3 },
  { title: "Must-do: cold shower 5 minutes", why: "You know why.", time: "07:40", difficulty: 3 },
  { title: "Must-do: 20 minutes cardio", why: "Burpees, stairs, or bike — no pause.", time: "18:30", difficulty: 3 },
];

function blankSlots() {
  return { morning: [], afternoon: [], evening: [] };
}

/** Earliest calendar day penalties and misses may apply (install day vs penalty cursor). */
export function penaltyFloorDate(state, today) {
  const started = state.startedOn || today;
  const since = state.penaltySince || started;
  return started > since ? started : since;
}

/** First day the user actually used Ember (install or first completed quest). */
export function firstUseDate(state, today) {
  const started = state.startedOn || today;
  let earliest = started;
  for (const event of state.xpEvents || []) {
    const d = event?.date;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < earliest) earliest = d;
  }
  for (const [date, day] of Object.entries(state.days || {})) {
    if (!day?.slots) continue;
    let anyDone = false;
    for (const slot of SLOTS) {
      for (const task of day.slots[slot] || []) {
        if (task?.done) anyDone = true;
      }
    }
    if (anyDone && date < earliest) earliest = date;
  }
  return earliest;
}

function missFloor(state, today) {
  const use = firstUseDate(state, today);
  const floor = penaltyFloorDate(state, today);
  return use > floor ? use : floor;
}

function isScheduledIncomplete(state, date, today) {
  if (date >= today) return false;
  if (date <= (state.startedOn || today)) return false;
  const total = taskCount(state, date);
  if (!total) return false;
  return !isFullDay(state, date);
}

/** Days strictly before today with scheduled quests still incomplete (since first use / penalty floor). */
export function missedDatesBefore(state, today) {
  const floor = missFloor(state, today);
  const missed = [];
  let cursor = addDays(today, -1);
  for (let i = 0; i < 21; i += 1) {
    if (cursor < floor) break;
    if (cursor <= (state.startedOn || today)) break;
    if (isComplete(state, cursor)) return missed.reverse();
    if (isScheduledIncomplete(state, cursor, today)) missed.push(cursor);
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

function hashSeed(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickFromPool(difficultyCap, seed) {
  const pool = PENALTY_CATALOG.filter((item) => item.difficulty <= difficultyCap);
  const idx = hashSeed(seed) % pool.length;
  return pool[idx];
}

/** How many must-do quests to assign for `missedDayCount` newly processed misses. */
export function mustDoQuestCount(missedDayCount) {
  const k = Math.max(0, Math.min(8, Number(missedDayCount) || 0));
  if (!k) return 0;
  if (k === 1) return 1;
  return Math.min(6, k + 1 + Math.floor((k - 1) / 2));
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

export function currencyBlocked(state, today) {
  return hasOpenPenaltyQuest(state, today);
}

export function openPenaltyQuests(state, date) {
  const day = state.days?.[date];
  if (!day) return [];
  const list = [];
  for (const slot of SLOTS) {
    for (const task of day.slots?.[slot] || []) {
      if (task.penaltyTag === PENALTY_TAG && !task.done) list.push({ slot, task });
    }
  }
  return list;
}

function injectMustDoPenalties(state, today, missedDates) {
  const count = mustDoQuestCount(missedDates.length);
  if (!count) return 0;
  if (!state.days[today]) state.days[today] = { slots: blankSlots() };
  let added = 0;
  const seen = new Set(
    SLOTS.flatMap((slot) => (state.days[today].slots[slot] || []).map((t) => t.title)),
  );
  for (let i = 0; i < count; i += 1) {
    const difficulty = Math.min(3, 1 + Math.floor((missedDates.length + i) / 2));
    const seed = `${today}|${missedDates.join(",")}|${i}`;
    let spec = pickFromPool(difficulty, seed);
    let tries = 0;
    while (seen.has(spec.title) && tries < PENALTY_CATALOG.length) {
      spec = pickFromPool(difficulty, `${seed}|${tries}`);
      tries += 1;
    }
    seen.add(spec.title);
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
    const slot = i % 2 === 0 ? "morning" : "afternoon";
    state.days[today].slots[slot].unshift(task);
    added += 1;
  }
  return added;
}

/**
 * Run once per app open / settle. Processes newly discovered missed days since last penalty cursor.
 * Returns report for UI if anything new happened today.
 */
export function processPenalties(state, today, now) {
  const processed = new Set(Array.isArray(state.penaltyProcessed) ? state.penaltyProcessed : []);
  const since = penaltyFloorDate(state, today);
  const pending = missedDatesBefore(state, today).filter((d) => !processed.has(d));
  for (const date of pending) {
    if (date < since) processed.add(date);
  }
  const missed = pending.filter((d) => d >= since && isScheduledIncomplete(state, d, today));
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

  const mustDoAdded = injectMustDoPenalties(state, today, missed);

  const report = {
    id: uid(),
    at: now.toISOString(),
    dates,
    questsMissed,
    xpLost,
    streakReset: true,
    mustDoAdded,
  };

  state.lastPenaltyReport = report;
  state.penaltyReports = [report, ...(state.penaltyReports || [])].slice(0, 20);

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
  return { left, timeLeft, full, weekend: false };
}