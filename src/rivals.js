import { XP_WORKOUT } from "./constants.js";
import { levelFor, questXpForLevel } from "./economy.js";
import { ago } from "./format.js";
import { bestWeek, sameDayComparison, streakCount, totalXp, weekPace, xpOnDate } from "./stats.js";
import { addDays, dateKey, formatWeekSpan, isWeekend, minuteOfDay, weekdayLong, weekStart, zonedTimeToUtc } from "./time.js";
import { describeBest, describeSameDay, describeWeekPace } from "./copy.js";

/**
 * Simulated training partners. A day's plan is a pure function of the rival,
 * the date, and the saved XP ledgers, then stored on the phone. Reopening
 * replays that plan; it does not roll a new one. Task XP uses the same
 * per-level quest formula as the user. Missed days are filled in for the
 * time since the last open, and only tasks whose clock time has passed count.
 */
export const RIVAL_WINDOWS = {
  morning: [7 * 60, 9 * 60 + 15],
  afternoon: [12 * 60 + 30, 16 * 60],
  evening: [17 * 60 + 15, 21 * 60],
};

export const RIVALS = [
  {
    id: "leo",
    name: "Leo Berg",
    city: "Göteborg",
    offset: 0,
    activity: 0.88,
    swing: 0.7,
    mult: 1,
    workoutRate: 0.55,
    quests: ["Push session", "Evening walk", "Lights out by 22:30", "Core work"],
    voice: "Steady and a bit competitive. Talks like a gym buddy who trains most days and keeps score without being mean.",
    profile: {
      variance: 0.55,
      bursts: ["morning", "evening"],
      ambition: 0.86,
      slump: 1,
      comeback: 0,
      breakRate: 0.06,
    },
  },
  {
    id: "maja",
    name: "Maja Lind",
    city: "Malmö",
    offset: -1,
    activity: 0.7,
    swing: 1.35,
    mult: 1.12,
    workoutRate: 0.34,
    quests: ["Focus block", "Easy run", "Language drill", "Cook a real dinner"],
    voice: "Warm but streaky. Some weeks she disappears, then comes back with a sharp comeback.",
    profile: {
      variance: 1.25,
      bursts: ["afternoon", "evening"],
      ambition: 0.8,
      slump: 0.42,
      comeback: 0.58,
      breakRate: 0.03,
    },
  },
  {
    id: "noah",
    name: "Noah Ek",
    city: "Uppsala",
    offset: 1,
    activity: 0.93,
    swing: 0.5,
    mult: 1.2,
    workoutRate: 0.48,
    quests: ["Easy run", "Read 10 pages", "Mobility", "Early night"],
    voice: "Quietly ahead, a little nerdy, proud of consistency and early nights.",
    profile: {
      variance: 0.32,
      bursts: ["morning", "afternoon"],
      ambition: 0.92,
      slump: 1,
      comeback: 0,
      breakRate: 0.045,
    },
  },
  {
    id: "amina",
    name: "Amina Adeyemi",
    city: "Stockholm",
    offset: -1,
    activity: 0.8,
    swing: 1.15,
    mult: 0.9,
    workoutRate: 0.42,
    quests: ["Skill practice", "Mobility", "Cook dinner", "One hard problem"],
    voice: "Dry Stockholm humor. Motivates without fluff; notices real effort.",
    profile: {
      variance: 0.9,
      bursts: ["afternoon", "evening"],
      ambition: 0.74,
      slump: 0.72,
      comeback: 0.34,
      breakRate: 0.05,
    },
  },
];

export function hashString(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function unit(value) {
  return (hashString(value) % 100000) / 100000;
}

export function tasksForRivalLevel(level) {
  const l = Math.max(1, Math.min(10, Number(level) || 1));
  if (l <= 3) return 1;
  if (l <= 6) return 2;
  if (l <= 9) return 3;
  return 4;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/** A full default template day: 5 quests on school days, 3 on the weekend. */
export function templateQuestCount(date) {
  return isWeekend(date) ? 3 : 5;
}

function legacySimRivalDay(rival, date, rivalLevel) {
  const active = unit(`${rival.id}:${date}:on`) < rival.activity;
  const minute = 7 * 60 + Math.floor(unit(`${rival.id}:${date}:time`) * 14 * 60);
  if (!active) {
    return { xp: 0, rest: true, workout: false, quest: null, minute, tasks: 0 };
  }
  const level = Math.max(1, Math.min(10, Number(rivalLevel) || 1));
  const tasks = tasksForRivalLevel(level);
  const perQuest = questXpForLevel(level);
  const swing = 0.92 + unit(`${rival.id}:${date}:swing`) * 0.16 * rival.swing;
  let xp = Math.round(tasks * perQuest * rival.mult * swing);
  const workout = unit(`${rival.id}:${date}:wo`) < rival.workoutRate;
  if (workout) xp += XP_WORKOUT;
  const quest = rival.quests[hashString(`${rival.id}:${date}:q`) % rival.quests.length];
  return { xp, rest: false, workout, quest, minute, tasks };
}

function moodShift(rival, date) {
  const variance = Math.min(1.4, Number(rival.profile?.variance) || 0.5);
  const roll = unit(`${rival.id}:${date}:mood`);
  const badCut = 0.07 + 0.1 * variance;
  const goodCut = 0.06 + 0.08 * variance;
  if (roll < badCut) return -1;
  if (roll > 1 - goodCut) return 1;
  return 0;
}

function showsUp(rival, date, yesterdayRest) {
  const profile = rival.profile || {};
  if (unit(`${rival.id}:${date}:break`) < (Number(profile.breakRate) || 0)) return false;
  let chance = Number(rival.activity) || 0;
  if (yesterdayRest) {
    const rebound = unit(`${rival.id}:${date}:rebound`);
    if (profile.comeback && rebound < profile.comeback) chance = Math.max(chance, 0.92);
    else if (profile.slump && profile.slump < 1) chance *= profile.slump;
  }
  return unit(`${rival.id}:${date}:on`) < chance;
}

function assignSlots(rival, date, count) {
  const prefer = rival.profile?.bursts?.length ? rival.profile.bursts : ["morning", "afternoon", "evening"];
  const all = ["morning", "afternoon", "evening"];
  const order = [...prefer, ...all.filter((slot) => !prefer.includes(slot))];
  if (count <= 1) {
    const slot = prefer[hashString(`${rival.id}:${date}:slot`) % prefer.length];
    return [slot];
  }
  const slots = [];
  for (let i = 0; i < count; i += 1) slots.push(order[i % order.length]);
  return slots;
}

function minuteInWindow(rival, date, slot, index, used) {
  const [start, end] = RIVAL_WINDOWS[slot] || RIVAL_WINDOWS.afternoon;
  let minute = start;
  for (let guard = 0; guard < 8; guard += 1) {
    const span = Math.max(1, end - start);
    minute = start + Math.floor(unit(`${rival.id}:${date}:${slot}:${index}:${guard}`) * (span + 1));
    if (minute > end) minute = end;
    if (!used.some((taken) => Math.abs(taken - minute) < 20)) break;
  }
  used.push(minute);
  return minute;
}

/**
 * Personality day. Quest XP matches the user formula at this rival's level.
 * The day's budget stays under a perfect template day at the user's level,
 * and rises toward that ceiling when the user has been slacking.
 */
function planRivalDay(rival, date, rivalLevel, options) {
  const level = Math.max(1, Math.min(10, Number(rivalLevel) || 1));
  const userLevel = Math.max(1, Math.min(10, Number(options.userLevel) || 1));
  const minute = 7 * 60 + Math.floor(unit(`${rival.id}:${date}:time`) * 14 * 60);
  const mood = moodShift(rival, date);
  if (!showsUp(rival, date, Boolean(options.yesterdayRest))) {
    return {
      xp: 0,
      rest: true,
      workout: false,
      quest: null,
      minute,
      tasks: 0,
      mood,
      level,
      completions: [],
    };
  }
  const templateTasks = templateQuestCount(date);
  const userPer = questXpForLevel(userLevel);
  const per = questXpForLevel(level);
  const hardCap = templateTasks * userPer;
  let ambition = Number(rival.profile?.ambition) || 0.8;
  const variance = Math.min(1.4, Number(rival.profile?.variance) || 0.5);
  ambition += mood * (0.06 + 0.05 * variance);
  if (options.pressure) ambition += 0.14;
  if (options.ease) ambition -= 0.06;
  ambition = clamp(ambition, 0.38, options.pressure ? 1 : 0.94);
  const budget = Math.max(per, Math.round(hardCap * ambition));
  let tasks = Math.max(1, Math.min(templateTasks, Math.round(budget / per)));
  // A slacking user lets them schedule one more task, up to a full template day.
  // A consistent user stays inside a perfect quest day, so the week is still beatable.
  const ceiling = options.pressure ? Math.min(templateTasks * per, hardCap + per) : Math.min(budget, hardCap);
  if (options.pressure) tasks = Math.min(templateTasks, tasks + 1);
  while (tasks > 1 && tasks * per > ceiling) tasks -= 1;
  const workoutRoll = unit(`${rival.id}:${date}:wo`) < rival.workoutRate;
  const workout = workoutRoll && tasks * per <= hardCap;
  const slots = assignSlots(rival, date, tasks);
  const used = [];
  const completions = slots.map((slot, index) => ({
    slot,
    minute: minuteInWindow(rival, date, slot, index, used),
    quest: rival.quests[hashString(`${rival.id}:${date}:q:${index}`) % rival.quests.length],
    xp: per,
    kind: "task",
  }));
  if (workout) {
    const slot = rival.profile?.bursts?.includes("evening") ? "evening" : slots[slots.length - 1];
    completions.push({
      slot,
      minute: minuteInWindow(rival, date, slot, 9, used),
      quest: "Workout",
      xp: XP_WORKOUT,
      kind: "workout",
      workout: true,
    });
  }
  completions.sort((a, b) => a.minute - b.minute || (a.kind === "workout" ? 1 : -1));
  const xp = completions.reduce((sum, row) => sum + row.xp, 0);
  return {
    xp,
    rest: false,
    workout,
    quest: completions.find((row) => row.kind === "task")?.quest || null,
    minute: completions[0]?.minute ?? minute,
    tasks,
    mood,
    level,
    completions,
  };
}

export function simRivalDay(rival, date, rivalLevel, options) {
  if (!rival?.profile) return legacySimRivalDay(rival, date, rivalLevel);
  return planRivalDay(rival, date, rivalLevel, options || {});
}

export function ensureRivalXp(state) {
  if (!state.rivalXp || typeof state.rivalXp !== "object") state.rivalXp = {};
  for (const rival of RIVALS) {
    if (state.rivalXp[rival.id] == null) state.rivalXp[rival.id] = 0;
  }
  return state;
}

export function rivalDayXpSum(state, id, beforeDate = null) {
  let sum = 0;
  for (const [date, day] of Object.entries(state.rivalDays || {})) {
    if (beforeDate && date >= beforeDate) continue;
    const entry = day?.byId?.[id];
    if (entry && !entry.rest) sum += Number(entry.xp) || 0;
  }
  return sum;
}

export function rivalTotalXp(state, id) {
  ensureRivalXp(state);
  return (Number(state.rivalXp[id]) || 0) + rivalDayXpSum(state, id);
}

export function rivalXpBeforeDate(state, id, date) {
  ensureRivalXp(state);
  return (Number(state.rivalXp[id]) || 0) + rivalDayXpSum(state, id, date);
}

function userXpBefore(state, date) {
  let sum = 0;
  for (const event of state.xpEvents || []) {
    if (!event?.date || event.date >= date) continue;
    sum += Number(event.amount) || 0;
  }
  return sum;
}

function recentUserPace(state, date) {
  const start = state.startedOn || date;
  let sum = 0;
  let days = 0;
  for (let i = 1; i <= 7; i += 1) {
    const key = addDays(date, -i);
    if (key < start) break;
    sum += xpOnDate(state, key);
    days += 1;
  }
  return { avg: days ? sum / days : null, days };
}

function pruneRivalDays(state, today) {
  const cutoff = addDays(today, -100);
  ensureRivalXp(state);
  for (const key of Object.keys(state.rivalDays || {})) {
    if (key >= cutoff) continue;
    const day = state.rivalDays[key];
    for (const rival of RIVALS) {
      const entry = day?.byId?.[rival.id];
      if (entry && !entry.rest) {
        state.rivalXp[rival.id] = (Number(state.rivalXp[rival.id]) || 0) + (Number(entry.xp) || 0);
      }
    }
    delete state.rivalDays[key];
  }
}

export function ensureRivalHistory(state, today, now = null) {
  if (!state.rivalDays) state.rivalDays = {};
  ensureRivalXp(state);
  let wrote = false;
  for (let i = 90; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    if (state.rivalDays[date]) continue;
    const byId = {};
    const userLevel = levelFor(userXpBefore(state, date));
    const recent = recentUserPace(state, date);
    const perfectDaily = (31 / 7) * questXpForLevel(userLevel);
    const pressure = recent.days >= 2 && recent.avg < perfectDaily * 0.5;
    const ease = recent.days >= 2 && recent.avg > perfectDaily * 1.05;
    for (const rival of RIVALS) {
      const level = levelFor(rivalXpBeforeDate(state, rival.id, date));
      const yesterday = cell(state, addDays(date, -1), rival.id);
      const yesterdayRest = Boolean(yesterday) && (yesterday.rest || !(Number(yesterday.xp) > 0));
      byId[rival.id] = simRivalDay(rival, date, level, {
        userLevel,
        pressure,
        ease,
        yesterdayRest,
      });
    }
    state.rivalDays[date] = { byId };
    wrote = true;
  }
  pruneRivalDays(state, today);
  if (wrote || !state.rivalSimAt) {
    const stamp = now instanceof Date ? now : new Date();
    state.rivalSimAt = stamp.toISOString();
  }
  return state;
}

function cell(state, date, id) {
  return state.rivalDays?.[date]?.byId?.[id] || null;
}

export function dayProgress(now) {
  const mins = minuteOfDay(now);
  const start = 6 * 60;
  const end = 22 * 60;
  if (mins <= start) return 0.08;
  if (mins >= end) return 1;
  return (mins - start) / (end - start);
}

/** XP and tasks that have actually happened by `now`. Legacy days keep the old drip. */
export function rivalEntryProgress(entry, date, today, now) {
  if (!entry || entry.rest) {
    return { xp: 0, tasksDone: 0, tasksPlanned: 0, workoutDone: false, done: [] };
  }
  const planned = Array.isArray(entry.completions) ? entry.completions : null;
  if (!planned) {
    let xp = 0;
    if (date < today) xp = Number(entry.xp) || 0;
    else if (date === today) xp = Math.round((Number(entry.xp) || 0) * dayProgress(now));
    return {
      xp,
      tasksDone: xp > 0 ? Number(entry.tasks) || 0 : 0,
      tasksPlanned: Number(entry.tasks) || 0,
      workoutDone: Boolean(entry.workout) && xp > 0,
      done: [],
    };
  }
  const nowMin = date < today ? 24 * 60 + 1 : date === today ? minuteOfDay(now) : -1;
  const done = planned.filter((row) => row.minute <= nowMin);
  return {
    xp: done.reduce((sum, row) => sum + (Number(row.xp) || 0), 0),
    tasksDone: done.filter((row) => row.kind !== "workout").length,
    tasksPlanned: planned.filter((row) => row.kind !== "workout").length,
    workoutDone: done.some((row) => row.kind === "workout"),
    done,
  };
}

function rivalSuccess(state, id, date, now, today) {
  const entry = cell(state, date, id);
  if (!entry || entry.rest) return false;
  const progress = rivalEntryProgress(entry, date, today, now);
  return progress.xp > 0;
}

export function rivalStreak(state, id, today, now) {
  let cursor = rivalSuccess(state, id, today, now, today) ? today : addDays(today, -1);
  let count = 0;
  for (let i = 0; i < 120; i += 1) {
    if (!rivalSuccess(state, id, cursor, now, today)) break;
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function rivalWeekXp(state, id, today, now) {
  const start = weekStart(today);
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    if (date > today) break;
    const entry = cell(state, date, id);
    if (!entry || entry.rest) continue;
    sum += rivalEntryProgress(entry, date, today, now).xp;
  }
  return sum;
}

function eventEpoch(date, minute) {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return zonedTimeToUtc(date, `${hh}:${mm}`);
}

export function activityLine(name, entry, minutesAgo) {
  const workout = Boolean(entry.workout || entry.kind === "workout");
  if (workout && minutesAgo <= 90) return `${name} just finished a workout`;
  if (!workout && minutesAgo <= 90) return `${name} just checked off ${entry.quest}`;
  if (workout) return `${name} logged a workout`;
  return `${name} cleared “${entry.quest}”`;
}

function buildFeed(state, today, now) {
  const items = [];
  const nowMs = now.getTime();
  for (const rival of RIVALS) {
    for (const date of [today, addDays(today, -1)]) {
      const entry = cell(state, date, rival.id);
      if (!entry || entry.rest) continue;
      const progress = rivalEntryProgress(entry, date, today, now);
      const events = progress.done.length
        ? progress.done
        : entry.completions
          ? []
          : [{ quest: entry.quest, workout: entry.workout, minute: entry.minute, kind: entry.workout ? "workout" : "task" }];
      if (!entry.completions && !(Number(entry.xp) > 0)) continue;
      for (const row of events) {
        const at = eventEpoch(date, row.minute ?? entry.minute);
        if (at > nowMs) continue;
        const minutesAgo = (nowMs - at) / 60000;
        items.push({
          id: `${rival.id}:${date}:${row.minute ?? entry.minute}:${row.kind || "task"}`,
          rivalId: rival.id,
          name: rival.name,
          text: activityLine(rival.name.split(" ")[0], row, minutesAgo),
          at,
          ago: ago(nowMs - at),
        });
      }
    }
    const yesterday = addDays(today, -1);
    const yCell = cell(state, yesterday, rival.id);
    if (yCell?.rest) {
      const before = addDays(yesterday, -1);
      let lost = 0;
      let cursor = before;
      for (let i = 0; i < 60; i += 1) {
        const entry = cell(state, cursor, rival.id);
        if (!entry || entry.rest || entry.xp <= 0) break;
        lost += 1;
        cursor = addDays(cursor, -1);
      }
      if (lost >= 3) {
        const at = eventEpoch(yesterday, 21 * 60 + 30);
        if (nowMs - at < 36 * 3600 * 1000) {
          items.push({
            id: `${rival.id}:break:${yesterday}`,
            rivalId: rival.id,
            name: rival.name,
            text: `${rival.name.split(" ")[0]}'s ${lost}-day streak ended yesterday`,
            at,
            ago: ago(nowMs - at),
          });
        }
      }
    }
  }
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 8);
}

function statusFor(state, rival, today, now, streak) {
  const yesterday = addDays(today, -1);
  const yRest = cell(state, yesterday, rival.id)?.rest;
  if (yRest && streak === 0) return "Streak just broke";
  if (streak >= 2) return `${streak}-day streak`;
  if (rivalSuccess(state, rival.id, today, now, today)) return "Active today";
  const hour = minuteOfDay(now) / 60;
  if (hour < 22) return "Quiet so far";
  return "Quiet today";
}

export function buildBoard(state, now = new Date()) {
  const today = dateKey(now);
  ensureRivalHistory(state, today, now);
  const userLevel = levelFor(totalXp(state));
  const same = sameDayComparison(state, today, now);
  const pace = weekPace(state, today, now);
  const best = bestWeek(state, today);
  const sameCopy = describeSameDay(same);
  const paceCopy = describeWeekPace(pace);
  const bestCopy = describeBest({
    thisXp: best.thisXp,
    bestXp: best.bestXp,
    bestLabel: best.bestStart ? formatWeekSpan(best.bestStart) : "",
    isThisWeek: best.isThisWeek,
  });
  const partners = RIVALS.map((rival) => {
    const level = levelFor(rivalTotalXp(state, rival.id));
    const streak = rivalStreak(state, rival.id, today, now);
    return {
      id: rival.id,
      name: rival.name,
      city: rival.city,
      you: false,
      level,
      weekXp: rivalWeekXp(state, rival.id, today, now),
      streak,
      status: statusFor(state, rival, today, now, streak),
    };
  });
  const you = {
    id: "you",
    name: "You",
    city: "Stockholm",
    you: true,
    level: userLevel,
    weekXp: pace.thisXp,
    streak: streakCount(state, today),
    status: streakCount(state, today) ? `${streakCount(state, today)}-day streak` : "No streak yet",
  };
  const board = [...partners, you].sort((a, b) => b.weekXp - a.weekXp || (a.you ? -1 : 1));
  board.forEach((row, index) => {
    row.rank = index + 1;
  });
  const maxScore = Math.max(same.todayXp, same.thenXp, 1);
  return {
    today,
    same: { ...same, ...sameCopy, youPct: same.todayXp / maxScore, ghostPct: same.thenXp / maxScore },
    pace: { ...pace, ...paceCopy },
    best: { ...best, ...bestCopy, label: best.bestStart ? formatWeekSpan(best.bestStart) : "" },
    board,
    feed: buildFeed(state, today, now),
    weekdayToday: weekdayLong(today),
  };
}

export function xpOn(state, date) {
  return xpOnDate(state, date);
}

function recentActivityLines(state, rivalId, today, now) {
  const lines = [];
  for (let i = 0; i < 3; i += 1) {
    const date = addDays(today, -i);
    const entry = cell(state, date, rivalId);
    if (!entry) continue;
    if (entry.rest || !(Number(entry.xp) > 0)) {
      lines.push(`${date}: rest day`);
      continue;
    }
    const progress = rivalEntryProgress(entry, date, today, now);
    if (Array.isArray(entry.completions)) {
      const names = progress.done.filter((row) => row.kind !== "workout").map((row) => row.quest);
      const workout = progress.workoutDone ? ", workout" : "";
      lines.push(`${date}: ${progress.tasksDone} done${names.length ? ` (${names.slice(0, 3).join(", ")})` : ""}${workout}`);
    } else {
      lines.push(`${date}: ${entry.quest || "trained"} · ${progress.xp} XP`);
    }
  }
  return lines;
}

export function rivalPromptFacts(state, rivalId, now = new Date()) {
  const rival = RIVALS.find((row) => row.id === rivalId);
  if (!rival) return null;
  const today = dateKey(now);
  ensureRivalHistory(state, today, now);
  const board = buildBoard(state, now);
  const you = board.board.find((row) => row.you);
  const partner = board.board.find((row) => row.id === rivalId);
  const entry = cell(state, today, rivalId);
  const progress = rivalEntryProgress(entry, today, today, now);
  return {
    id: rival.id,
    name: rival.name,
    city: rival.city,
    voice: rival.voice,
    weekXp: partner?.weekXp ?? rivalWeekXp(state, rivalId, today, now),
    streak: partner?.streak ?? rivalStreak(state, rivalId, today, now),
    status: partner?.status || "",
    todayQuest: entry?.rest ? null : entry?.quest || null,
    todayRest: Boolean(entry?.rest),
    todayWorkout: Boolean(entry?.workout),
    todayTasksDone: progress.tasksDone,
    todayTasksPlanned: progress.tasksPlanned,
    todayXp: progress.xp,
    recentActivity: recentActivityLines(state, rivalId, today, now),
    youWeekXp: you?.weekXp ?? 0,
    youStreak: you?.streak ?? 0,
    youTodayXp: board.same?.todayXp ?? 0,
    noActions: true,
  };
}
