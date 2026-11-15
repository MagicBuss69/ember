import {
  CRYSTAL_FULL,
  CRYSTAL_LEVEL,
  CRYSTAL_MILESTONES,
  CRYSTAL_STREAK_DAY,
  DEFAULT_GOALS,
  SLOTS,
  THEMES,
  WEEKDAY_QUESTS,
  WEEKEND_QUESTS,
  XP_WORKOUT,
} from "./constants.js";
import { levelFor, questXpForLevel } from "./economy.js";
import { currencyBlocked } from "./penalty.js";
import { uid } from "./format.js";
import {
  confirmChallenge,
  defaultChallengeSettings,
  foldChallengesIntoPrepare,
  normalizeQuietNight,
  normalizeQuietSchool,
} from "./challenges.js";
import { migrateStateV2 } from "./migrate.js";
import { clearPenaltyReport, processPenalties } from "./penalty.js";
import { isComplete, isFullDay, streakCount, totalXp } from "./stats.js";
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
    isEvent: Boolean(partial.isEvent),
    done: false,
    doneAt: null,
  };
}

export function validTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
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
      theme: "frost",
      sound: true,
      soundVolume: 0.72,
      crystalSkin: "default",
      checkFx: "shards",
      soundPack: "system",
      equippedTitle: "",
      haptics: true,
      doneSlotsOpen: {},
      dismissedHint: false,
      geminiKeyStatus: "",
      driveLinked: false,
      driveAutoBackup: true,
      driveLastBackupOn: "",
      driveLastBackupAt: "",
      workerToken: "",
      pushOn: false,
      ...defaultChallengeSettings(),
    },
    crystals: 0,
    crystalLog: [],
    ownedThemes: ["ember", "frost"],
    ownedSkins: ["default"],
    ownedTitles: [],
    ownedBadges: [],
    ownedFx: ["shards"],
    ownedSoundPacks: ["system"],
    customRewards: [],
    penaltyProcessed: [],
    penaltyReports: [],
    penaltySince: today,
    lastPenaltyReport: null,
    crystalStress: 0,
    grants: {},
    template,
    days,
    workouts: [],
    xpEvents: [],
    longest: 0,
    rivalDays: {},
    rivalXp: {},
    challenges: {
      current: null,
      nextRollAt: null,
      difficultyStep: 0,
      processedInbox: [],
    },
    challengeInbox: [],
  };
}

function ensureWeek(state, today) {
  const start = weekStart(today);
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(start, i);
    if (!state.days[key]) state.days[key] = dayFromTemplate(state.template, key);
  }
}

function isLockedPenalty(task) {
  return Boolean(task?.penaltyTag);
}

function addCrystals(state, delta, reason, now, today) {
  if (delta > 0 && today && currencyBlocked(state, today)) return;
  state.crystals = Math.max(0, (state.crystals || 0) + delta);
  state.crystalLog.unshift({ at: now.toISOString(), delta, reason });
  state.crystalLog = state.crystalLog.slice(0, 80);
}

function applyDayGrants(state, date, now, today) {
  if (today && date > today) return;
  const complete = isComplete(state, date);
  const full = isFullDay(state, date);
  const streakKey = `streakday:${date}`;
  const fullKey = `full:${date}`;
  if (complete && !state.grants[streakKey]) {
    state.grants[streakKey] = true;
    addCrystals(state, CRYSTAL_STREAK_DAY, "streak", now, today);
  } else if (!complete && state.grants[streakKey]) {
    delete state.grants[streakKey];
    addCrystals(state, -CRYSTAL_STREAK_DAY, "streak", now, today);
  }
  if (full && !state.grants[fullKey]) {
    state.grants[fullKey] = true;
    addCrystals(state, CRYSTAL_FULL, "full-day", now, today);
  } else if (!full && state.grants[fullKey]) {
    delete state.grants[fullKey];
    addCrystals(state, -CRYSTAL_FULL, "full-day", now, today);
  }
}

function applyMilestones(state, today, now) {
  const streak = streakCount(state, today);
  for (const [mark, amount] of Object.entries(CRYSTAL_MILESTONES)) {
    const value = Number(mark);
    const key = `mile:${value}`;
    if (streak >= value && !state.grants[key]) {
      state.grants[key] = today;
      addCrystals(state, amount, `streak-${value}`, now, today);
    } else if (streak < value && state.grants[key]) {
      delete state.grants[key];
    }
  }
}

function applyLevelGrants(state, now, today) {
  const level = levelFor(totalXp(state));
  for (let step = 2; step <= level; step += 1) {
    const key = `level:${step}`;
    if (!state.grants[key]) {
      state.grants[key] = true;
      addCrystals(state, CRYSTAL_LEVEL, "level", now, today);
    }
  }
}

export function settle(state, { today, touchDate, touchDates, now }) {
  ensureWeek(state, today);
  state.longest = Math.max(state.longest || 0, streakCount(state, today));
  applyLevelGrants(state, now, today);
  const dates = new Set([today]);
  if (touchDate) dates.add(touchDate);
  if (Array.isArray(touchDates)) {
    for (const date of touchDates) if (date) dates.add(date);
  }
  for (const date of dates) applyDayGrants(state, date, now, today);
  applyMilestones(state, today, now);
  return state;
}

export function prepare(state, now = new Date()) {
  const migrated = migrateStateV2(state, now);
  const next = clone(migrated);
  const today = dateKey(now);
  settle(next, { today, touchDate: today, now });
  const penalty = processPenalties(next, today, now);
  const out = foldChallengesIntoPrepare(penalty.state, now);
  if (totalXp(out) > 0 && isFullDay(out, today)) {
    out.crystalStress = Math.max(0, (Number(out.crystalStress) || 0) - 0.08);
  }
  return {
    state: out,
    today,
    penaltyReport: penalty.report,
    penaltyFresh: penalty.fresh,
  };
}

export function acknowledgePenalty(state) {
  const next = clone(state);
  return clearPenaltyReport(next);
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
    const reward = questXpForLevel(levelFor(totalXp(next)));
    pushXp(next, { date, amount: reward, source: "task", ref: task.id, now });
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
  if (isLockedPenalty(task)) return next;
  const title = String(fields.title || "").trim().slice(0, 80);
  if (!title) return next;
  task.title = title;
  task.why = String(fields.why || "").trim().slice(0, 160);
  task.time = validTime(fields.time);
  if (typeof fields.isEvent === "boolean") task.isEvent = fields.isEvent;
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
  const victim = list.find((item) => item.id === taskId);
  if (isLockedPenalty(victim)) return next;
  next.days[date].slots[slot] = list.filter((item) => item.id !== taskId);
  dropXp(next, taskId, "task");
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

/**
 * Move a quest to `toSlot` at `toIndex` (0-based in the destination after removal).
 * Works within a slot or across Morning / Afternoon / Evening; XP and done state stay attached.
 */
export function moveTask(state, date, fromSlot, taskId, toSlot, toIndex, now = new Date()) {
  const next = clone(state);
  if (!SLOTS.includes(fromSlot) || !SLOTS.includes(toSlot)) return next;
  const slots = next.days[date]?.slots;
  if (!slots) return next;
  const fromList = slots[fromSlot];
  const fromIndex = fromList?.findIndex((item) => item.id === taskId) ?? -1;
  if (fromIndex < 0) return next;
  if (isLockedPenalty(fromList[fromIndex])) return next;
  const [task] = fromList.splice(fromIndex, 1);
  const dest = slots[toSlot];
  const clamped = Math.max(0, Math.min(dest.length, Number.isFinite(toIndex) ? Math.trunc(toIndex) : dest.length));
  dest.splice(clamped, 0, task);
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

/** Step a quest one position up (`dir = -1`) or down (`dir = 1`), crossing slots at the edges. */
export function stepTask(state, date, slot, taskId, dir, now = new Date()) {
  const slots = state.days[date]?.slots;
  if (!slots || !SLOTS.includes(slot)) return clone(state);
  const list = slots[slot] || [];
  const index = list.findIndex((item) => item.id === taskId);
  if (index < 0) return clone(state);
  if (isLockedPenalty(list[index])) return clone(state);
  const step = dir < 0 ? -1 : 1;
  if (step < 0) {
    if (index > 0) return moveTask(state, date, slot, taskId, slot, index - 1, now);
    const slotIdx = SLOTS.indexOf(slot);
    if (slotIdx <= 0) return clone(state);
    const prevSlot = SLOTS[slotIdx - 1];
    return moveTask(state, date, slot, taskId, prevSlot, (slots[prevSlot] || []).length, now);
  }
  if (index < list.length - 1) return moveTask(state, date, slot, taskId, slot, index + 1, now);
  const slotIdx = SLOTS.indexOf(slot);
  if (slotIdx < 0 || slotIdx >= SLOTS.length - 1) return clone(state);
  const nextSlot = SLOTS[slotIdx + 1];
  return moveTask(state, date, slot, taskId, nextSlot, 0, now);
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

/**
 * Move a template quest on `weekday` (`"1"`..`"7"`) to `toSlot` at `toIndex`
 * (0-based in destination after removal). Works within a slot or across Morning / Afternoon / Evening.
 */
export function moveTemplateTask(state, weekday, fromSlot, taskId, toSlot, toIndex) {
  const next = clone(state);
  if (!SLOTS.includes(fromSlot) || !SLOTS.includes(toSlot)) return next;
  const slots = next.template?.[String(weekday)];
  if (!slots) return next;
  const fromList = slots[fromSlot];
  const fromIndex = fromList?.findIndex((item) => item.id === taskId) ?? -1;
  if (fromIndex < 0) return next;
  const [task] = fromList.splice(fromIndex, 1);
  const dest = slots[toSlot];
  const clamped = Math.max(0, Math.min(dest.length, Number.isFinite(toIndex) ? Math.trunc(toIndex) : dest.length));
  dest.splice(clamped, 0, task);
  return next;
}

/** Step a template quest one position up (`dir = -1`) or down (`dir = 1`), crossing slots at the edges. */
export function stepTemplateTask(state, weekday, slot, taskId, dir) {
  const wd = String(weekday);
  const slots = state.template?.[wd];
  if (!slots || !SLOTS.includes(slot)) return clone(state);
  const list = slots[slot] || [];
  const index = list.findIndex((item) => item.id === taskId);
  if (index < 0) return clone(state);
  const step = dir < 0 ? -1 : 1;
  if (step < 0) {
    if (index > 0) return moveTemplateTask(state, wd, slot, taskId, slot, index - 1);
    const slotIdx = SLOTS.indexOf(slot);
    if (slotIdx <= 0) return clone(state);
    const prevSlot = SLOTS[slotIdx - 1];
    return moveTemplateTask(state, wd, slot, taskId, prevSlot, (slots[prevSlot] || []).length);
  }
  if (index < list.length - 1) return moveTemplateTask(state, wd, slot, taskId, slot, index + 1);
  const slotIdx = SLOTS.indexOf(slot);
  if (slotIdx < 0 || slotIdx >= SLOTS.length - 1) return clone(state);
  const nextSlot = SLOTS[slotIdx + 1];
  return moveTemplateTask(state, wd, slot, taskId, nextSlot, 0);
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

export function templateTaskCount(state, weekday) {
  const slots = state.template?.[String(weekday)];
  if (!slots) return 0;
  return SLOTS.reduce((sum, slot) => sum + (slots[slot]?.length || 0), 0);
}

export function occupiedCopyTargets(state, kind, targets) {
  const unique = [...new Set((targets || []).map(String))];
  if (kind === "template") {
    return unique.filter((wd) => templateTaskCount(state, wd) > 0);
  }
  return unique.filter((date) => {
    const slots = state.days?.[date]?.slots;
    if (!slots) return false;
    return SLOTS.some((slot) => (slots[slot]?.length || 0) > 0);
  });
}

/**
 * Copy all quests from `sourceDate` onto `targetDates` in Week mode.
 * `mode`: `"replace"` overwrites each target day (clearing XP for overwritten done quests);
 * `"append"` adds copied quests after existing quests in each slot.
 * Every copied quest gets a fresh id and `done: false` while keeping title, why, time, slot, and order.
 */
export function copyDayToDates(state, sourceDate, targetDates, mode = "replace", now = new Date()) {
  const next = clone(state);
  const sourceSlots = next.days?.[sourceDate]?.slots || blankSlots();
  const replace = mode !== "append";
  const targets = [...new Set((targetDates || []).map(String))].filter(
    (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== sourceDate,
  );
  if (!targets.length) return { state: next, copied: 0 };

  for (const targetDate of targets) {
    if (!next.days[targetDate]) next.days[targetDate] = { slots: blankSlots() };
    const destSlots = next.days[targetDate].slots;
    for (const slot of SLOTS) {
      const fresh = (sourceSlots[slot] || []).map((item) => taskFrom(item));
      if (replace) {
        for (const existing of destSlots[slot] || []) {
          if (existing?.id) dropXp(next, existing.id, "task");
        }
        destSlots[slot] = fresh;
      } else {
        destSlots[slot] = [...(destSlots[slot] || []), ...fresh];
      }
    }
  }

  settle(next, { today: dateKey(now), touchDates: targets, now });
  return { state: next, copied: targets.length };
}

/**
 * Copy all quests from `sourceWeekday` (`"1"`..`"7"`) onto `targetWeekdays` in Template mode.
 * `mode`: `"replace"` overwrites each target weekday; `"append"` appends in each slot.
 */
export function copyTemplateWeekday(state, sourceWeekday, targetWeekdays, mode = "replace") {
  const next = clone(state);
  const srcKey = String(sourceWeekday);
  const sourceSlots = next.template?.[srcKey] || blankSlots();
  const replace = mode !== "append";
  const targets = [...new Set((targetWeekdays || []).map(String))].filter(
    (wd) => /^[1-7]$/.test(wd) && wd !== srcKey,
  );
  if (!targets.length) return { state: next, copied: 0 };

  for (const wd of targets) {
    if (!next.template[wd]) next.template[wd] = blankSlots();
    for (const slot of SLOTS) {
      const fresh = (sourceSlots[slot] || []).map((item) => blueprint(item));
      if (replace) {
        next.template[wd][slot] = fresh;
      } else {
        next.template[wd][slot] = [...(next.template[wd][slot] || []), ...fresh];
      }
    }
  }

  return { state: next, copied: targets.length };
}

function mergeTemplatePreservingEvents(template, existingDay, date) {
  const fresh = dayFromTemplate(template, date);
  if (!existingDay?.slots) return fresh;
  for (const slot of SLOTS) {
    const events = (existingDay.slots[slot] || []).filter((item) => item.isEvent);
    if (events.length) fresh.slots[slot] = [...events, ...fresh.slots[slot]];
  }
  return fresh;
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
    next.days[date] = mergeTemplatePreservingEvents(next.template, day, date);
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

export function confirmActiveChallenge(state, now = new Date()) {
  const next = clone(state);
  if (!confirmChallenge(next, now)) return { state: next, ok: false };
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
  if (typeof patch.soundVolume === "number") {
    next.settings.soundVolume = Math.max(0, Math.min(1, patch.soundVolume));
  }
  if (typeof patch.haptics === "boolean") next.settings.haptics = patch.haptics;
  if (typeof patch.theme === "string" && next.ownedThemes?.includes(patch.theme)) {
    next.settings.theme = patch.theme;
  }
  if (typeof patch.crystalSkin === "string" && (next.ownedSkins || []).includes(patch.crystalSkin)) {
    next.settings.crystalSkin = patch.crystalSkin;
  }
  if (typeof patch.equippedTitle === "string" && (!patch.equippedTitle || (next.ownedTitles || []).includes(patch.equippedTitle))) {
    next.settings.equippedTitle = patch.equippedTitle.slice(0, 40);
  }
  if (typeof patch.checkFx === "string" && (next.ownedFx || []).includes(patch.checkFx)) {
    next.settings.checkFx = patch.checkFx;
  }
  if (typeof patch.soundPack === "string" && (next.ownedSoundPacks || []).includes(patch.soundPack)) {
    next.settings.soundPack = patch.soundPack;
  }
  if (typeof patch.dismissedHint === "boolean") next.settings.dismissedHint = patch.dismissedHint;
  if (typeof patch.geminiKeyStatus === "string") next.settings.geminiKeyStatus = patch.geminiKeyStatus.slice(0, 20);
  if (typeof patch.driveLinked === "boolean") next.settings.driveLinked = patch.driveLinked;
  if (typeof patch.driveAutoBackup === "boolean") next.settings.driveAutoBackup = patch.driveAutoBackup;
  if (typeof patch.driveLastBackupOn === "string") next.settings.driveLastBackupOn = patch.driveLastBackupOn.slice(0, 10);
  if (typeof patch.driveLastBackupAt === "string") next.settings.driveLastBackupAt = patch.driveLastBackupAt.slice(0, 40);
  if (typeof patch.workerToken === "string") next.settings.workerToken = patch.workerToken.trim().slice(0, 200);
  if (typeof patch.pushOn === "boolean") next.settings.pushOn = patch.pushOn;
  if (typeof patch.challengesOn === "boolean") next.settings.challengesOn = patch.challengesOn;
  if (patch.quietSchool && typeof patch.quietSchool === "object") {
    next.settings.quietSchool = normalizeQuietSchool({ ...next.settings.quietSchool, ...patch.quietSchool });
  }
  if (patch.quietNight && typeof patch.quietNight === "object") {
    next.settings.quietNight = normalizeQuietNight({ ...next.settings.quietNight, ...patch.quietNight });
  }
  if (Array.isArray(patch.blockedPackages)) {
    next.settings.blockedPackages = patch.blockedPackages
      .map((pkg) => String(pkg || "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 64);
  }
  if (patch.doneSlotsOpen && typeof patch.doneSlotsOpen === "object") {
    const clean = {};
    for (const [key, value] of Object.entries(patch.doneSlotsOpen)) {
      if (value && typeof key === "string" && key.length <= 48) clean[key.slice(0, 48)] = true;
    }
    next.settings.doneSlotsOpen = clean;
  }
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
  next.days[date] = mergeTemplatePreservingEvents(next.template, day, date);
  settle(next, { today: dateKey(now), touchDate: date, now });
  return next;
}

export { isWeekend };
