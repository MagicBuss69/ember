import { levelFor } from "./economy.js";
import { ago } from "./format.js";
import { bestWeek, sameDayComparison, streakCount, totalXp, weekPace, xpOnDate } from "./stats.js";
import { addDays, dateKey, formatWeekSpan, minuteOfDay, weekdayLong, weekStart, zonedTimeToUtc } from "./time.js";
import { describeBest, describeSameDay, describeWeekPace } from "./copy.js";

/**
 * Simulated training partners. Everything here is derived on this phone from a
 * hash of the date, so it stays still across reloads and moves only when the
 * clock does. They are not accounts and never leave the device.
 */
export const RIVALS = [
  {
    id: "leo",
    name: "Leo Berg",
    city: "Göteborg",
    offset: 0,
    activity: 0.82,
    swing: 0.7,
    mult: 1,
    workoutRate: 0.55,
    quests: ["Push session", "Evening walk", "Lights out by 22:30", "Core work"],
    voice: "Steady and a bit competitive. Talks like a gym buddy who trains most days and keeps score without being mean.",
  },
  {
    id: "maja",
    name: "Maja Lind",
    city: "Malmö",
    offset: -1,
    activity: 0.46,
    swing: 1.35,
    mult: 1.12,
    workoutRate: 0.34,
    quests: ["Focus block", "Easy run", "Language drill", "Cook a real dinner"],
    voice: "Warm but streaky. Some weeks she disappears, then comes back with a sharp comeback.",
  },
  {
    id: "noah",
    name: "Noah Ek",
    city: "Uppsala",
    offset: 1,
    activity: 0.76,
    swing: 0.5,
    mult: 1.2,
    workoutRate: 0.68,
    quests: ["Easy run", "Read 10 pages", "Mobility", "Early night"],
    voice: "Quietly ahead, a little nerdy, proud of consistency and early nights.",
  },
  {
    id: "amina",
    name: "Amina Adeyemi",
    city: "Stockholm",
    offset: -1,
    activity: 0.58,
    swing: 1.15,
    mult: 0.9,
    workoutRate: 0.42,
    quests: ["Skill practice", "Mobility", "Cook dinner", "One hard problem"],
    voice: "Dry Stockholm humor. Motivates without fluff; notices real effort.",
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

function dayBase(level) {
  return 28 + level * 6;
}

export function simRivalDay(rival, date, level) {
  const active = unit(`${rival.id}:${date}:on`) < rival.activity;
  const minute = 7 * 60 + Math.floor(unit(`${rival.id}:${date}:time`) * 14 * 60);
  if (!active) {
    return { xp: 0, rest: true, workout: false, quest: null, minute };
  }
  const swing = 0.55 + unit(`${rival.id}:${date}:swing`) * rival.swing;
  let xp = Math.round(dayBase(level) * rival.mult * swing);
  const workout = unit(`${rival.id}:${date}:wo`) < rival.workoutRate;
  if (workout) xp += Math.round(16 + unit(`${rival.id}:${date}:wox`) * 24);
  const quest = rival.quests[hashString(`${rival.id}:${date}:q`) % rival.quests.length];
  return { xp, rest: false, workout, quest, minute };
}

function levelAtStart(state, date) {
  const xp = (state.xpEvents || [])
    .filter((event) => event.date < date)
    .reduce((sum, event) => sum + (Number(event.amount) || 0), 0);
  return levelFor(xp);
}

export function ensureRivalHistory(state, today) {
  if (!state.rivalDays) state.rivalDays = {};
  for (let i = 90; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    if (state.rivalDays[date]) continue;
    const level = levelAtStart(state, date);
    const byId = {};
    for (const rival of RIVALS) byId[rival.id] = simRivalDay(rival, date, level);
    state.rivalDays[date] = { level, byId };
  }
  const cutoff = addDays(today, -100);
  for (const key of Object.keys(state.rivalDays)) {
    if (key < cutoff) delete state.rivalDays[key];
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

function rivalSuccess(state, id, date, now, today) {
  const entry = cell(state, date, id);
  if (!entry || entry.rest || entry.xp <= 0) return false;
  if (date !== today) return true;
  return minuteOfDay(now) >= entry.minute;
}

export function rivalStreak(state, id, today, now) {
  let cursor = rivalSuccess(state, id, today, now, today) ? today : addDays(today, -1);
  let count = 0;
  for (let i = 0; i < 120; i += 1) {
    if (cursor === today) {
      if (!rivalSuccess(state, id, today, now, today)) break;
      count += 1;
    } else {
      const entry = cell(state, cursor, id);
      if (!entry || entry.rest || entry.xp <= 0) break;
      count += 1;
    }
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
    const fraction = date === today ? dayProgress(now) : 1;
    sum += Math.round(entry.xp * fraction);
  }
  return sum;
}

function eventEpoch(date, minute) {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return zonedTimeToUtc(date, `${hh}:${mm}`);
}

export function activityLine(name, entry, minutesAgo) {
  if (entry.workout && minutesAgo <= 90) return `${name} just finished a workout`;
  if (!entry.workout && minutesAgo <= 90) return `${name} just checked off ${entry.quest}`;
  if (entry.workout) return `${name} logged a workout`;
  return `${name} cleared “${entry.quest}”`;
}

function buildFeed(state, today, now) {
  const items = [];
  const nowMs = now.getTime();
  for (const rival of RIVALS) {
    for (const date of [today, addDays(today, -1)]) {
      const entry = cell(state, date, rival.id);
      if (!entry || entry.rest) continue;
      const at = eventEpoch(date, entry.minute);
      if (at > nowMs) continue;
      const minutesAgo = (nowMs - at) / 60000;
      items.push({
        id: `${rival.id}:${date}`,
        rivalId: rival.id,
        name: rival.name,
        text: activityLine(rival.name.split(" ")[0], entry, minutesAgo),
        at,
        ago: ago(nowMs - at),
      });
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
  ensureRivalHistory(state, today);
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
    const wobble = rival.id === "maja" && unit(`${weekStart(today)}:maja`) < 0.5 ? 1 : 0;
    const level = Math.min(10, Math.max(1, userLevel + rival.offset + wobble));
    return {
      id: rival.id,
      name: rival.name,
      city: rival.city,
      you: false,
      level,
      weekXp: rivalWeekXp(state, rival.id, today, now),
      streak: rivalStreak(state, rival.id, today, now),
      status: statusFor(state, rival, today, now, rivalStreak(state, rival.id, today, now)),
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

export function rivalPromptFacts(state, rivalId, now = new Date()) {
  const rival = RIVALS.find((row) => row.id === rivalId);
  if (!rival) return null;
  const today = dateKey(now);
  ensureRivalHistory(state, today);
  const board = buildBoard(state, now);
  const you = board.board.find((row) => row.you);
  const partner = board.board.find((row) => row.id === rivalId);
  const entry = cell(state, today, rivalId);
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
    youWeekXp: you?.weekXp ?? 0,
    youStreak: you?.streak ?? 0,
    youTodayXp: board.same?.todayXp ?? 0,
    noActions: true,
  };
}
