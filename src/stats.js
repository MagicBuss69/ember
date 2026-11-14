import { SLOTS, XP_TASK } from "./constants.js";
import { addDays, dateKey, minuteOfDay, weekdayLong, weekStart, zonedTimeToUtc } from "./time.js";

export function totalXp(state) {
  return (state.xpEvents || []).reduce((sum, event) => sum + (Number(event.amount) || 0), 0);
}

export function xpOnDate(state, date) {
  return (state.xpEvents || [])
    .filter((event) => event.date === date)
    .reduce((sum, event) => sum + (Number(event.amount) || 0), 0);
}

export function tasksOn(state, date) {
  const day = state.days?.[date];
  if (!day) return [];
  const all = [];
  for (const slot of SLOTS) {
    for (const task of day.slots?.[slot] || []) all.push(task);
  }
  return all;
}

export function taskCount(state, date) {
  return tasksOn(state, date).length;
}

export function doneCount(state, date) {
  return tasksOn(state, date).filter((task) => task.done).length;
}

export function isComplete(state, date) {
  return doneCount(state, date) > 0;
}

export function isFullDay(state, date) {
  const tasks = tasksOn(state, date);
  return tasks.length > 0 && tasks.every((task) => task.done);
}

/**
 * Consecutive completed days ending today, or yesterday if today has none yet.
 */
export function streakCount(state, today) {
  let cursor = isComplete(state, today) ? today : addDays(today, -1);
  let count = 0;
  for (let i = 0; i < 500; i += 1) {
    if (isComplete(state, cursor)) count += 1;
    else break;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** Missed dates immediately before today (incomplete days with quests). */
export function rawGap(state, today) {
  const dates = [];
  let cursor = addDays(today, -1);
  for (let i = 0; i < 21; i += 1) {
    if (isComplete(state, cursor)) return dates.reverse();
    if (taskCount(state, cursor) > 0) dates.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates.reverse();
}

export function dayFraction(done, total) {
  if (!total) return 0;
  return done / total;
}

export function sameDayComparison(state, today, now) {
  const thenDate = addDays(today, -7);
  return {
    todayXp: xpOnDate(state, today),
    thenXp: xpOnDate(state, thenDate),
    thenDate,
    weekdayName: weekdayLong(thenDate),
    dayOpen: true,
  };
}

export function weekPace(state, today, now) {
  const thisStart = weekStart(today);
  const lastStart = addDays(thisStart, -7);
  const lastSame = addDays(today, -7);
  const cutoff = zonedTimeToUtc(lastSame, hhmm(now));
  const nowMs = now.getTime();
  let thisXp = 0;
  let paceXp = 0;
  let lastFull = 0;
  let hasHistory = false;
  for (const event of state.xpEvents || []) {
    const at = new Date(event.at).getTime();
    if (event.date >= thisStart && event.date <= today) {
      if (event.date < today || at <= nowMs) thisXp += Number(event.amount) || 0;
    }
    if (event.date >= lastStart && event.date <= addDays(lastStart, 6)) {
      hasHistory = true;
      lastFull += Number(event.amount) || 0;
      if (event.date < lastSame) paceXp += Number(event.amount) || 0;
      else if (event.date === lastSame) {
        const loggedOn = dateKey(new Date(event.at));
        if (loggedOn !== event.date || at <= cutoff) paceXp += Number(event.amount) || 0;
      }
    }
  }
  return { thisXp, paceXp, lastFull, hasHistory, thisStart, lastStart };
}

function hhmm(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const bag = {};
  for (const part of parts) if (part.type !== "literal") bag[part.type] = part.value;
  const hour = bag.hour === "24" ? "00" : bag.hour;
  return `${hour}:${bag.minute}`;
}

export function bestWeek(state, today) {
  const totals = new Map();
  for (const event of state.xpEvents || []) {
    if (!event.date) continue;
    const start = weekStart(event.date);
    totals.set(start, (totals.get(start) || 0) + (Number(event.amount) || 0));
  }
  let bestXp = 0;
  let bestStart = null;
  for (const [start, xp] of totals) {
    if (xp > bestXp) {
      bestXp = xp;
      bestStart = start;
    }
  }
  const thisStart = weekStart(today);
  const thisXp = totals.get(thisStart) || 0;
  return {
    bestXp,
    bestStart,
    thisXp,
    isThisWeek: bestStart === thisStart && bestXp > 0,
  };
}

export function summarizeWeek(state, today) {
  const start = weekStart(today);
  const end = addDays(start, 6);
  const bars = [0, 0, 0, 0, 0, 0, 0];
  let sets = 0;
  let volume = 0;
  let km = 0;
  let minutes = 0;
  let sessions = 0;
  for (const workout of state.workouts || []) {
    if (workout.date < start || workout.date > end) continue;
    sessions += 1;
    const index = Math.min(6, Math.max(0, daysBetween(start, workout.date)));
    bars[index] += 1;
    if (workout.kind === "cardio") {
      km += Number(workout.distanceKm) || 0;
      minutes += Number(workout.durationMin) || 0;
    } else {
      for (const set of workout.sets || []) {
        sets += 1;
        volume += (Number(set.reps) || 0) * (Number(set.weightKg) || 0);
      }
    }
  }
  return { start, end, sets, volume, km, minutes, sessions, bars };
}

function daysBetween(start, end) {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.round((b - a) / 86400000);
}

export function exerciseGroups(state) {
  const groups = new Map();
  const workouts = [...(state.workouts || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const workout of workouts) {
    const key = workout.name.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: workout.name.trim(),
        kind: workout.kind,
        sessions: [],
        best: null,
      });
    }
    const group = groups.get(key);
    group.sessions.push(workout);
    group.best = betterMark(group.best, workout);
  }
  return [...groups.values()];
}

function betterMark(current, workout) {
  if (workout.kind === "cardio") {
    const distance = Number(workout.distanceKm) || 0;
    if (!current || distance > current.distance) {
      return { distance, label: distance ? `${distance} km` : `${workout.durationMin || 0} min` };
    }
    return current;
  }
  let best = current;
  for (const set of workout.sets || []) {
    const weight = Number(set.weightKg) || 0;
    const reps = Number(set.reps) || 0;
    const score = weight * 1000 + reps;
    if (!best || score > best.score) {
      best = {
        score,
        label: weight > 0 ? `${weight} kg × ${reps}` : `${reps} reps`,
      };
    }
  }
  return best;
}

export function openTodayCount(state, today) {
  return Math.max(0, taskCount(state, today) - doneCount(state, today));
}

export function ringNumbers(state, date) {
  const total = taskCount(state, date);
  const done = doneCount(state, date);
  return { total, done, pct: dayFraction(done, total) };
}

export { minuteOfDay, XP_TASK };
