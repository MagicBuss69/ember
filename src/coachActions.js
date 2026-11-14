import { SLOTS } from "./constants.js";
import {
  addTask,
  addTemplateTask,
  applyGeneratedPlan,
  applyTemplateToOpenDays,
  copyDayToDates,
  copyDayToTemplate,
  copyTemplateWeekday,
  deleteTask,
  deleteTemplateTask,
  moveTask,
  occupiedCopyTargets,
  patchSettings,
  replaceDayFromTemplate,
  setTaskDone,
  updateTask,
  updateTemplateTask,
} from "./domain.js";
import { normalizePlan } from "./gemini.js";
import { taskCount } from "./stats.js";
import { dateKey, weekdayIso } from "./time.js";

export const MAX_COACH_ACTIONS = 6;

const ALLOWED = new Set([
  "addQuest",
  "addEvent",
  "addTemplateQuest",
  "setQuestDone",
  "updateQuest",
  "updateEvent",
  "updateTemplateQuest",
  "deleteQuest",
  "deleteEvent",
  "deleteTemplateQuest",
  "moveQuest",
  "copyDay",
  "copyTemplate",
  "fillOpenDays",
  "saveDayToTemplate",
  "useTemplateOnDay",
  "applyWeekPlan",
  "setGoals",
  "patchSettings",
]);

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isWeekday(value) {
  const wd = String(value);
  return /^[1-7]$/.test(wd);
}

function isSlot(value) {
  return SLOTS.includes(value);
}

function findDayTask(state, taskId) {
  for (const date of Object.keys(state.days || {})) {
    for (const slot of SLOTS) {
      const task = state.days[date]?.slots?.[slot]?.find((item) => item.id === taskId);
      if (task) return { date, slot, task };
    }
  }
  return null;
}

function findTemplateTask(state, taskId) {
  for (const wd of Object.keys(state.template || {})) {
    for (const slot of SLOTS) {
      const task = state.template[wd]?.[slot]?.find((item) => item.id === taskId);
      if (task) return { weekday: wd, slot, task };
    }
  }
  return null;
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TEMPLATE_MISS = Symbol("templateMiss");

function previewTitle(task, action) {
  const title = String(task?.title || action?.title || "").trim().slice(0, 40);
  return title || "unknown";
}

function weekdayLabel(value) {
  if (value == null || value === "") return "?";
  const text = String(value);
  const index = Number(text);
  if (Number.isInteger(index) && WEEKDAY_LABELS[index - 1]) return WEEKDAY_LABELS[index - 1];
  return `weekday ${text}`;
}

function weekdayText(value) {
  if (value == null || value === "") return "";
  return String(value);
}

function templateHas(state, weekday, slot, taskId) {
  const list = state.template?.[weekday]?.[slot];
  return Array.isArray(list) && list.some((item) => item.id === taskId);
}

function missTemplate() {
  return { [TEMPLATE_MISS]: "That template quest wasn't found." };
}

function actionMode(action) {
  return action.mode === "append" ? "append" : "replace";
}

export function isDestructiveAction(action, state) {
  if (!action || typeof action !== "object") return true;
  const name = action.name;
  if (!name) return true;
  if (name === "deleteQuest" || name === "deleteEvent" || name === "deleteTemplateQuest") return true;
  if (name === "setQuestDone") return true;
  if (name === "updateQuest" || name === "updateEvent" || name === "updateTemplateQuest") return true;
  if (name === "saveDayToTemplate") return true;
  if (name === "applyWeekPlan" || name === "setGoals") return true;
  if (name === "useTemplateOnDay") {
    const date = action.date;
    if (isDate(date) && taskCount(state, date) > 0) return true;
    return false;
  }
  if (name === "copyDay") return actionMode(action) === "replace";
  if (name === "copyTemplate") return actionMode(action) === "replace";
  if (name === "patchSettings") {
    const forbidden = ["geminiApiKey", "geminiKeyStatus", "workerToken", "pushOn", "driveLinked", "driveAutoBackup", "driveLastBackupOn", "driveLastBackupAt", "goals"];
    for (const key of forbidden) {
      if (key in action) return true;
    }
    return false;
  }
  return false;
}

export function previewCoachAction(action, state) {
  const name = action?.name || "action";
  if (name === "addQuest" || name === "addEvent") {
    return `Add ${name === "addEvent" ? "event" : "quest"} “${String(action.title || "").slice(0, 40)}” on ${action.date || "?"}`;
  }
  if (name === "deleteQuest" || name === "deleteEvent" || name === "updateQuest" || name === "updateEvent") {
    const found = action.taskId ? findDayTask(state, action.taskId) : null;
    const title = previewTitle(found?.task, action);
    const date = found?.date || action.date || "?";
    const kind = name === "deleteEvent" || name === "updateEvent" ? "event" : "quest";
    const verb = name.startsWith("delete") ? "Delete" : "Update";
    return `${verb} ${kind} “${title}” on ${date}`;
  }
  if (name === "updateTemplateQuest" || name === "deleteTemplateQuest") {
    const found = action.taskId ? findTemplateTask(state, action.taskId) : null;
    const title = previewTitle(found?.task, action);
    const day = weekdayLabel(found?.weekday ?? action.weekday);
    const verb = name === "deleteTemplateQuest" ? "Delete" : "Update";
    return `${verb} template quest “${title}” on ${day}`;
  }
  if (name === "setQuestDone") {
    const found = action.taskId ? findDayTask(state, action.taskId) : null;
    const title = previewTitle(found?.task, action);
    const date = found?.date || action.date || "?";
    const mark = action.done === false ? "undone" : "done";
    return `Mark quest “${title}” ${mark} on ${date}`;
  }
  if (name === "setGoals") return "Replace your goals text";
  if (name === "applyWeekPlan") return "Replace the weekly template from Gemini's plan";
  if (name === "copyDay" && actionMode(action) === "replace") return "Replace quests on selected days";
  if (name === "copyTemplate" && actionMode(action) === "replace") return "Replace template weekdays";
  if (name === "saveDayToTemplate") return `Overwrite ${action.weekday || "?"}. template from ${action.date || "?"}`;
  if (name === "useTemplateOnDay") return `Fill ${action.date || "?"} from template (may overwrite)`;
  return `${name}`;
}

function sanitizeList(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((raw) => {
    if (!raw || typeof raw !== "object") return { invalid: true, name: "" };
    const name = String(raw.name || "").trim();
    if (!ALLOWED.has(name)) return { invalid: true, name };
    const next = { name };
    for (const [key, value] of Object.entries(raw)) {
      if (key === "name") continue;
      if (typeof value === "string") next[key] = value.slice(0, 2000);
      else if (typeof value === "boolean" || typeof value === "number") next[key] = value;
      else if (Array.isArray(value)) next[key] = value.slice(0, 14);
      else if (key === "plan" && value && typeof value === "object") next.plan = value;
    }
    return next;
  });
}

export function planCoachTurn(state, rawActions, { confirmed = false } = {}) {
  const actions = sanitizeList(rawActions);
  if (actions.some((a) => a?.invalid)) {
    return { ok: false, error: "That reply included actions Ember can't run.", state };
  }
  if (actions.length > MAX_COACH_ACTIONS) {
    return { ok: false, error: "Too many actions at once.", state };
  }
  const accepted = actions.slice(0, MAX_COACH_ACTIONS);
  const destructive = accepted.filter((a) => isDestructiveAction(a, state));
  if (destructive.length && !confirmed) {
    return {
      ok: false,
      needsConfirm: true,
      state,
      actions: accepted,
      previews: accepted.map((a) => previewCoachAction(a, state)),
    };
  }
  return { ok: true, state, actions: accepted, destructive: destructive.length > 0 };
}

function applyOne(state, action, now) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return state;
  const today = dateKey(now);
  const name = action.name;

  if (name === "addQuest" || name === "addEvent") {
    if (!isDate(action.date) || !isSlot(action.slot)) return state;
    const title = String(action.title || "").trim();
    if (!title) return state;
    return addTask(
      state,
      action.date,
      action.slot,
      {
        title,
        why: action.why || "",
        time: action.time || "",
        isEvent: name === "addEvent",
        saveTemplate: false,
      },
      now,
    );
  }

  if (name === "addTemplateQuest") {
    const wd = String(action.weekday);
    if (!isWeekday(wd) || !isSlot(action.slot)) return state;
    const title = String(action.title || "").trim();
    if (!title) return state;
    return addTemplateTask(state, wd, action.slot, {
      title,
      why: action.why || "",
      time: action.time || "",
    });
  }

  if (name === "setQuestDone") {
    let date = action.date;
    let slot = action.slot;
    const taskId = action.taskId;
    if (!taskId) return state;
    if (!date || !slot) {
      const found = findDayTask(state, taskId);
      if (!found) return state;
      date = found.date;
      slot = found.slot;
    }
    if (!isDate(date) || !isSlot(slot)) return state;
    return setTaskDone(state, date, slot, taskId, action.done !== false, now);
  }

  if (name === "updateQuest" || name === "updateEvent") {
    let date = action.date;
    let slot = action.slot;
    const taskId = action.taskId;
    if (!taskId) return state;
    if (!date || !slot) {
      const found = findDayTask(state, taskId);
      if (!found) return state;
      date = found.date;
      slot = found.slot;
    }
    const fields = {
      title: action.title,
      why: action.why,
      time: action.time,
      slot: action.slot,
      isEvent: name === "updateEvent" ? true : undefined,
    };
    return updateTask(state, date, slot, taskId, fields, now);
  }

  if (name === "updateTemplateQuest") {
    let wd = weekdayText(action.weekday);
    let slot = action.slot;
    const taskId = action.taskId;
    if (!taskId) return missTemplate();
    if (!wd || !slot) {
      const found = findTemplateTask(state, taskId);
      if (!found) return missTemplate();
      wd = found.weekday;
      slot = found.slot;
    }
    if (!isWeekday(wd) || !isSlot(slot) || !templateHas(state, wd, slot, taskId)) return missTemplate();
    return updateTemplateTask(state, wd, slot, taskId, {
      title: action.title,
      why: action.why,
      time: action.time,
      slot: action.slot,
    });
  }

  if (name === "deleteQuest" || name === "deleteEvent") {
    let date = action.date;
    let slot = action.slot;
    const taskId = action.taskId;
    if (!taskId) return state;
    if (!date || !slot) {
      const found = findDayTask(state, taskId);
      if (!found) return state;
      date = found.date;
      slot = found.slot;
    }
    return deleteTask(state, date, slot, taskId, now);
  }

  if (name === "deleteTemplateQuest") {
    let wd = weekdayText(action.weekday);
    let slot = action.slot;
    const taskId = action.taskId;
    if (!taskId) return missTemplate();
    if (!wd || !slot) {
      const found = findTemplateTask(state, taskId);
      if (!found) return missTemplate();
      wd = found.weekday;
      slot = found.slot;
    }
    if (!isWeekday(wd) || !isSlot(slot) || !templateHas(state, wd, slot, taskId)) return missTemplate();
    return deleteTemplateTask(state, wd, slot, taskId);
  }

  if (name === "moveQuest") {
    const taskId = action.taskId;
    if (!taskId || !isDate(action.date)) return state;
    let fromSlot = action.fromSlot;
    if (!fromSlot) {
      const found = findDayTask(state, taskId);
      if (!found || found.date !== action.date) return state;
      fromSlot = found.slot;
    }
    if (!isSlot(fromSlot) || !isSlot(action.toSlot)) return state;
    const toIndex = Number.isFinite(action.toIndex) ? Math.trunc(action.toIndex) : 999;
    return moveTask(state, action.date, fromSlot, taskId, action.toSlot, toIndex, now);
  }

  if (name === "copyDay") {
    if (!isDate(action.sourceDate)) return state;
    const targets = (action.targetDates || []).filter(isDate);
    if (!targets.length) return state;
    const result = copyDayToDates(state, action.sourceDate, targets, actionMode(action), now);
    return result.state;
  }

  if (name === "copyTemplate") {
    const src = String(action.sourceWeekday);
    if (!isWeekday(src)) return state;
    const targets = (action.targetWeekdays || []).map(String).filter(isWeekday);
    if (!targets.length) return state;
    const result = copyTemplateWeekday(state, src, targets, actionMode(action));
    return result.state;
  }

  if (name === "fillOpenDays") {
    const result = applyTemplateToOpenDays(state, today, now);
    return result.state;
  }

  if (name === "saveDayToTemplate") {
    if (!isDate(action.date)) return state;
    return copyDayToTemplate(state, action.date);
  }

  if (name === "useTemplateOnDay") {
    if (!isDate(action.date)) return state;
    return replaceDayFromTemplate(state, action.date, now);
  }

  if (name === "applyWeekPlan") {
    try {
      const plan = normalizePlan(action.plan || {});
      const result = applyGeneratedPlan(state, plan, today, now);
      return result.state;
    } catch {
      return state;
    }
  }

  if (name === "setGoals") {
    const goals = String(action.goals || "").slice(0, 2000);
    return patchSettings(state, { goals });
  }

  if (name === "patchSettings") {
    const patch = {};
    if (typeof action.sound === "boolean") patch.sound = action.sound;
    if (typeof action.haptics === "boolean") patch.haptics = action.haptics;
    if (typeof action.soundVolume === "number") patch.soundVolume = action.soundVolume;
    if (typeof action.theme === "string") patch.theme = action.theme;
    if (typeof action.crystalSkin === "string") patch.crystalSkin = action.crystalSkin;
    if (typeof action.equippedTitle === "string") patch.equippedTitle = action.equippedTitle;
    if (typeof action.checkFx === "string") patch.checkFx = action.checkFx;
    if (typeof action.soundPack === "string") patch.soundPack = action.soundPack;
    if (!Object.keys(patch).length) return state;
    return patchSettings(state, patch);
  }

  return state;
}

export function applyCoachActions(state, actions, now = new Date(), options = {}) {
  const plan = planCoachTurn(state, actions, options);
  if (!plan.ok) return plan;
  let next = state;
  for (const action of plan.actions) {
    const before = next;
    const result = applyOne(next, action, now);
    if (result?.[TEMPLATE_MISS]) {
      return { ok: false, error: result[TEMPLATE_MISS], state };
    }
    next = result;
    if (next === before && action.name.startsWith("delete")) {
      /* penalty or missing ids — continue */
    }
  }
  return { ok: true, state: next, applied: plan.actions.length };
}