import { SLOTS } from "./constants.js";
import { levelFor } from "./economy.js";
import { openTodayCount, streakCount, totalXp } from "./stats.js";
import { addDays, dateKey, weekStart, weekdayIso } from "./time.js";

function questLine(task) {
  return {
    id: task.id,
    title: task.title,
    slot: task.slot,
    time: task.time || "",
    why: task.why || "",
    done: Boolean(task.done),
    isEvent: Boolean(task.isEvent),
  };
}

export function buildCoachContext(state, now = new Date()) {
  const today = dateKey(now);
  const start = weekStart(today);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const week = weekDates.map((date) => {
    const day = state.days?.[date];
    const quests = [];
    if (day?.slots) {
      for (const slot of SLOTS) {
        for (const task of day.slots[slot] || []) {
          quests.push({ ...questLine(task), slot });
        }
      }
    }
    return { date, weekday: weekdayIso(date), quests };
  });

  const template = {};
  for (let wd = 1; wd <= 7; wd += 1) {
    const key = String(wd);
    const slots = state.template?.[key];
    if (!slots) continue;
    const quests = [];
    for (const slot of SLOTS) {
      for (const task of slots[slot] || []) {
        quests.push({
          id: task.id,
          title: task.title,
          slot,
          time: task.time || "",
          why: task.why || "",
        });
      }
    }
    template[key] = quests;
  }

  const events = [];
  for (let i = 0; i < 14; i += 1) {
    const date = addDays(today, i);
    const day = state.days?.[date];
    if (!day?.slots) continue;
    for (const slot of SLOTS) {
      for (const task of day.slots[slot] || []) {
        if (!task.isEvent) continue;
        events.push({
          date,
          slot,
          id: task.id,
          title: task.title,
          time: task.time || "",
        });
      }
    }
  }

  const settings = {
    goals: String(state.settings?.goals || "").slice(0, 500),
    theme: state.settings?.theme || "frost",
    sound: state.settings?.sound !== false,
    haptics: state.settings?.haptics !== false,
    ownedThemes: (state.ownedThemes || []).slice(0, 12),
    ownedSkins: (state.ownedSkins || []).slice(0, 12),
    hasGeminiKey: Boolean(state.settings?.geminiApiKey),
  };

  return {
    today,
    timezone: "Europe/Stockholm",
    level: levelFor(totalXp(state)),
    streak: streakCount(state, today),
    crystals: state.crystals || 0,
    openQuestsToday: openTodayCount(state, today),
    week,
    template,
    events,
    settings,
    actionSchema:
      "Return JSON {reply, actions[]}. Max 6 actions. Names: addQuest, addEvent, addTemplateQuest, setQuestDone, updateQuest, updateEvent, updateTemplateQuest, deleteQuest, deleteEvent, deleteTemplateQuest, moveQuest, copyDay, copyTemplate, fillOpenDays, saveDayToTemplate, useTemplateOnDay, applyWeekPlan, setGoals, patchSettings.",
  };
}