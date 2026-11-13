import {
  CRYSTAL_FULL,
  CRYSTAL_LEVEL,
  CRYSTAL_MILESTONES,
  CRYSTAL_STREAK_DAY,
  DEFAULT_GOALS,
  FREEZE_PRICE,
  SLOTS,
  THEMES,
  WEEKDAY_QUESTS,
  WEEKEND_QUESTS,
  XP_TASK,
  XP_WORKOUT,
} from "./constants.js";
import { levelFor } from "./economy.js";
import { uid } from "./format.js";
import { isComplete, isFullDay, isFrozen, rawGap, streakCount, totalXp } from "./stats.js";
import { addDays, dateKey, isWeekend, weekStart, weekdayIso } from "./time.js";

function clone(value) {
  return structuredClone(value);
}

function blankSlots() {
  return { morning: [], afternoon: [], evening: [] };
}

function blueprint(partial) {
  return {
    id: uid(),
    title: String(partial.title || "").trim().slice(0, 80),
    why: String(partial.why || "").trim().slice(0, 160),
    time: validTime(partial.time),
  };
}

function taskFrom(partial) {
  return {
    ...blueprint(partial),
    done: false,
    doneAt: null,
  };
}

export function validTime(value) {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

function templateFromList(list) {
  const slots = blankSlots();
  for (const item of list) slots[item.slot].push(blueprint(item));
  return slots;
}

function dayFromTemplate(template, date) {
  const wd = String(weekdayIso(date));
  const source = template[wd] || blankSlots();
  const slots = blankSlots();
  for (const slot of SLOTS) {
    slots[slot] = (source[slot] || []).map((item) => taskFrom(item));
  }
  return { slots };
}

function emptyTemplate() {
  const template = {};
  for (let wd = 1; wd <= 7; wd += 1) {
    const list = wd >= 6 ? WEEKEND_QUESTS : WEEKDAY_QUESTS;
    template[String(wd)] = templateFromList(list);
  }
  return template;
}

export function createInitialState(now = new Date()) {
  const today = dateKey(now);
  const template = emptyTemplate();
  const days = {};
  const start = weekStart(today);
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(start, i);
    days[key] = dayFromTemplate(template, key);
  }
  return {
    version: 1,
    startedOn: today,
    settings: {
      geminiApiKey: "",
      goals: DEFAULT_GOALS,
      theme: "ember",
      sound: true,
      haptics: true,
      dismissedHint: false,
    },
    crystals: 0,
    crystalLog: [],
    freezes: 0,
    freezeLog: [],
    ownedThemes: ["ember"],
    grants: {},
    template,
    days,
    workouts: [],
    xpEvents: [],
    longest: 0,
    rivalDays: {},
  };
}

function ensureWeek(state, today) {
  const start = weekStart(today);
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(start, i);
    if (!state.days[key]) state.days[key] = dayFromTemplate(state.template, key);
  }
}

function addCrystals(state, delta, reason, now) {
  state.crystals = Math.max(0, (state.crystals || 0) + delta);
  state.crystalLog.unshift({ at: now.toISOString(), delta, reason });
  state.crystalLog = state.crystalLog.slice(0, 80);
}

function applyFreezes(state, today, now) {
  const gap = rawGap(state, today);
  if (!gap.length || gap.length > state.freezes) return [];
  const used = [];
  for (const date of gap) {
    state.freezes -= 1;
    const entry = { date, at: now.toISOString() };
    state.freezeLog.push(entry);
    used.push(entry);
  }
  return used;
}

function applyDayGrants(state, date, now) {
  const complete = isComplete(state, date);
  const full = isFullDay(state, date);
  const streakKey = `streakday:${date}`;
  const fullKey = `full:${date}`;
  if (complete && !state.grants[streakKey]) {
    state.grants[streakKey] = true;
    addCrystals(state, CRYSTAL_STREAK_DAY, "streak", now);
  } else if (!complete && state.grants[streakKey]) {
    delete state.grants[streakKey];
    addCrystals(state, -CRYSTAL_STREAK_DAY, "streak", now);
  }
  if (full && !state.grants[fullKey]) {
    state.grants[fullKey] = true;
    addCrystals(state, CRYSTAL_FULL, "full-day", now);
  } else if (!full && state.grants[fullKey]) {
    delete state.grants[fullKey];
    addCrystals(state, -CRYSTAL_FULL, "full-day", now);
  }
}

function applyMilestones(state, today, now) {
  const streak = streakCount(state, today);
  for (const [mark, amount] of Object.entries(CRYSTAL_MILESTONES)) {
    const value = Number(mark);
    const key = `mile:${value}`;
    if (streak >= value && !state.grants[key]) {
      state.grants[key] = today;
      addCrystals(state, amount, `streak-${value}`, now);
    } else if (streak < value && state.grants[key]) {
      delete state.grants[key];
    }
  }
}

function applyLevelGrants(state, now) {
  const level = levelFor(totalXp(state));
  for (let step = 2; step <= level; step += 1) {
    const key = `level:${step}`;
    if (!state.grants[key]) {
      state.grants[key] = true;
      addCrystals(state, CRYSTAL_LEVEL, "level", now);
    }
  }
}

export function settle(state, { today, touchDate, now }) {
  ensureWeek(state, today);
  applyFreezes(state, today, now);
  state.longest = Math.max(state.longest || 0, streakCount(state, today));
  applyLevelGrants(state, now);
  const dates = new Set([today]);
  if (touchDate) dates.add(touchDate);
  for (const date of dates) applyDayGrants(state, date, now);
  applyMilestones(state, today, now);
  return state;
}

export function prepare(state, now = new Date()) {
  const next = clone(state);
  const today = dateKey(now);
  const before = next.freezeLog.length;
  settle(next, { today, touchDate: today, now });
  return { state: next, today, freezesUsed: next.freezeLog.slice(before) };
}

function pushXp(state, { date, amount, source, ref, now }) {
  if (state.xpEvents.some((event) => event.ref === ref && event.source === source)) return;
  state.xpEvents.push({
    id: uid(),
    at: now.toISOString(),
    date,
    amount,
    source,
    ref,
  });
}

function dropXp(state, ref, source) {
  state.xpEvents = state.xpEvents.filter((event) => !(event.ref === ref && event.source === source));
}

export function setTaskDone(state, date, slot, taskId, done, now = new Date()) {
  const next = clone(state);
  const task = next.days[date]?.slots?.[slot]?.find((item) => item.id === taskId);
  if (!task) return next;
  if (done && !task.done) {
    task.done = true;
    task.doneAt = now.toISOString();
    pushXp(next, { date, amount: XP_TASK, source: "task", ref: task.id, now });
  } else if (!done && task.done) {
    task.done = false;
    task.doneAt = null;
    dropXp(next, task.id, "task");
  }
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export function addTask(state, date, slot, fields, now = new Date()) {
  const next = clone(state);
  if (!next.days[date]) next.days[date] = { slots: blankSlots() };
  const task = taskFrom(fields);
  if (!task.title) return next;
  next.days[date].slots[slot].push(task);
  if (fields.saveTemplate) {
    const wd = String(weekdayIso(date));
    next.template[wd][slot].push(blueprint(fields));
  }
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export function updateTask(state, date, slot, taskId, fields, now = new Date()) {
  const next = clone(state);
  const list = next.days[date]?.slots?.[slot];
  const index = list?.findIndex((item) => item.id === taskId) ?? -1;
  if (index < 0) return next;
  const task = list[index];
  const title = String(fields.title || "").trim().slice(0, 80);
  if (!title) return next;
  task.title = title;
  task.why = String(fields.why || "").trim().slice(0, 160);
  task.time = validTime(fields.time);
  const target = SLOTS.includes(fields.slot) ? fields.slot : slot;
  if (target !== slot) {
    list.splice(index, 1);
    next.days[date].slots[target].push(task);
  }
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export function deleteTask(state, date, slot, taskId, now = new Date()) {
  const next = clone(state);
  const list = next.days[date]?.slots?.[slot];
  if (!list) return next;
  next.days[date].slots[slot] = list.filter((item) => item.id !== taskId);
  dropXp(next, taskId, "task");
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export function addTemplateTask(state, weekday, slot, fields) {
  const next = clone(state);
  const task = blueprint(fields);
  if (!task.title || !next.template[weekday]) return next;
  next.template[weekday][slot].push(task);
  return next;
}

export function updateTemplateTask(state, weekday, slot, taskId, fields) {
  const next = clone(state);
  const list = next.template[weekday]?.[slot];
  const task = list?.find((item) => item.id === taskId);
  if (!task) return next;
  const title = String(fields.title || "").trim().slice(0, 80);
  if (!title) return next;
  task.title = title;
  task.why = String(fields.why || "").trim().slice(0, 160);
  task.time = validTime(fields.time);
  const target = SLOTS.includes(fields.slot) ? fields.slot : slot;
  if (target !== slot) {
    next.template[weekday][slot] = list.filter((item) => item.id !== taskId);
    next.template[weekday][target].push(task);
  }
  return next;
}

export function deleteTemplateTask(state, weekday, slot, taskId) {
  const next = clone(state);
  const list = next.template[weekday]?.[slot];
  if (!list) return next;
  next.template[weekday][slot] = list.filter((item) => item.id !== taskId);
  return next;
}

export function copyDayToTemplate(state, date) {
  const next = clone(state);
  const day = next.days[date];
  if (!day) return next;
  const wd = String(weekdayIso(date));
  const slots = blankSlots();
  for (const slot of SLOTS) {
    slots[slot] = (day.slots[slot] || []).map((task) => blueprint(task));
  }
  next.template[wd] = slots;
  return next;
}

export function applyTemplateToOpenDays(state, today, now = new Date()) {
  const next = clone(state);
  const start = weekStart(today);
  let filled = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const day = next.days[date];
    const started = day && SLOTS.some((slot) => (day.slots[slot] || []).some((task) => task.done));
    if (started) continue;
    next.days[date] = dayFromTemplate(next.template, date);
    filled += 1;
  }
  settle(next, { today, touchDate: today, now });
  return { state: next, filled };
}

export function applyGeneratedPlan(state, plan, today, now = new Date()) {
  const next = clone(state);
  for (const day of plan.days || []) {
    const wd = String(day.weekday);
    if (!next.template[wd]) continue;
    const slots = blankSlots();
    for (const slot of SLOTS) {
      const items = Array.isArray(day[slot]) ? day[slot] : [];
      for (const item of items) {
        if (countSlots(slots) >= 5) break;
        const task = blueprint(item);
        if (task.title) slots[slot].push(task);
      }
    }
    next.template[wd] = slots;
  }
  return applyTemplateToOpenDays(next, today, now);
}

function countSlots(slots) {
  return SLOTS.reduce((sum, slot) => sum + slots[slot].length, 0);
}

export function addWorkout(state, input, now = new Date()) {
  const next = clone(state);
  const name = String(input.name || "").trim().slice(0, 60);
  if (!name) return next;
  const id = uid();
  const kind = input.kind === "cardio" ? "cardio" : "strength";
  const workout = {
    id,
    date: input.date,
    name,
    kind,
    sets: kind === "strength"
      ? (input.sets || [])
          .map((set) => ({
            reps: Math.max(0, Math.round(Number(set.reps) || 0)),
            weightKg: Math.max(0, round1(Number(set.weightKg) || 0)),
          }))
          .filter((set) => set.reps > 0)
      : [],
    durationMin: kind === "cardio" ? Math.max(0, round1(Number(input.durationMin) || 0)) : null,
    distanceKm: kind === "cardio" ? Math.max(0, round1(Number(input.distanceKm) || 0)) : null,
    notes: String(input.notes || "").trim().slice(0, 160),
    createdAt: now.toISOString(),
  };
  if (kind === "strength" && workout.sets.length === 0) return next;
  if (kind === "cardio" && !workout.durationMin && !workout.distanceKm) return next;
  next.workouts.push(workout);
  pushXp(next, { date: workout.date, amount: XP_WORKOUT, source: "workout", ref: id, now });
  settle(next, { today: dateKey(now), touchDate: workout.date, now });
  return next;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function deleteWorkout(state, id, now = new Date()) {
  const next = clone(state);
  const workout = next.workouts.find((item) => item.id === id);
  next.workouts = next.workouts.filter((item) => item.id !== id);
  dropXp(next, id, "workout");
  settle(next, { today: dateKey(now), touchDate: workout?.date || dateKey(now), now });
  return next;
}

export function buyFreeze(state, now = new Date()) {
  const next = clone(state);
  if (next.crystals < FREEZE_PRICE) return { state: next, ok: false };
  next.crystals -= FREEZE_PRICE;
  next.freezes += 1;
  next.crystalLog.unshift({ at: now.toISOString(), delta: -FREEZE_PRICE, reason: "spent-freeze" });
  const today = dateKey(now);
  settle(next, { today, touchDate: today, now });
  return { state: next, ok: true };
}

export function buyTheme(state, themeId, now = new Date()) {
  const theme = THEMES.find((item) => item.id === themeId);
  const next = clone(state);
  if (!theme || theme.price <= 0) return { state: next, ok: false };
  if (next.ownedThemes.includes(themeId)) return { state: next, ok: false };
  if (next.crystals < theme.price) return { state: next, ok: false };
  next.crystals -= theme.price;
  next.ownedThemes.push(themeId);
  next.settings.theme = themeId;
  next.crystalLog.unshift({ at: now.toISOString(), delta: -theme.price, reason: `theme-${themeId}` });
  return { state: next, ok: true };
}

export function equipTheme(state, themeId) {
  const next = clone(state);
  if (!next.ownedThemes.includes(themeId)) return next;
  if (!THEMES.some((item) => item.id === themeId)) return next;
  next.settings.theme = themeId;
  return next;
}

export function patchSettings(state, patch) {
  const next = clone(state);
  if (typeof patch.goals === "string") next.settings.goals = patch.goals.slice(0, 2000);
  if (typeof patch.geminiApiKey === "string") next.settings.geminiApiKey = patch.geminiApiKey.trim().slice(0, 200);
  if (typeof patch.sound === "boolean") next.settings.sound = patch.sound;
  if (typeof patch.haptics === "boolean") next.settings.haptics = patch.haptics;
  if (typeof patch.dismissedHint === "boolean") next.settings.dismissedHint = patch.dismissedHint;
  return next;
}

export function materializeDay(state, date) {
  const next = clone(state);
  if (!next.days[date]) next.days[date] = dayFromTemplate(next.template, date);
  return next;
}

export function replaceDayFromTemplate(state, date, now = new Date()) {
  const next = clone(state);
  const day = next.days[date];
  if (day && SLOTS.some((slot) => (day.slots[slot] || []).some((task) => task.done))) return next;
  next.days[date] = dayFromTemplate(next.template, date);
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export { isWeekend };
