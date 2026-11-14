import { SLOTS } from "./constants.js";
import { addDays, weekdayIso } from "./time.js";

function tasksIn(day) {
  if (!day?.slots) return [];
  const all = [];
  for (const slot of SLOTS) all.push(...(day.slots[slot] || []));
  return all;
}

/** The reminder list the phone sends to Mag's worker. No API keys. */
export function buildSchedule(state, today) {
  const reminders = [];
  const horizon = [];
  for (let i = 0; i < 14; i += 1) horizon.push(addDays(today, i));

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const slots = state.template?.[String(weekday)] || {};
    for (const slot of SLOTS) {
      for (const task of slots[slot] || []) {
        if (!task.time || !task.title) continue;
        const skipDates = [];
        for (const date of horizon) {
          if (weekdayIso(date) !== weekday) continue;
          const day = state.days?.[date];
          if (!day) continue;
          const match = tasksIn(day).find((item) => item.title === task.title && item.time === task.time);
          if (!match || match.done) skipDates.push(date);
        }
        reminders.push({
          id: `tpl:${task.id}`,
          label: task.title,
          time: task.time,
          days: [weekday],
          skipDates,
        });
      }
    }
  }

  for (const date of horizon) {
    const day = state.days?.[date];
    if (!day) continue;
    const weekday = weekdayIso(date);
    const fromTemplate = new Set();
    const slots = state.template?.[String(weekday)] || {};
    for (const slot of SLOTS) {
      for (const task of slots[slot] || []) fromTemplate.add(`${task.title}|${task.time}`);
    }
    for (const task of tasksIn(day)) {
      if (!task.time || !task.title || task.done) continue;
      if (fromTemplate.has(`${task.title}|${task.time}`)) continue;
      reminders.push({
        id: `once:${task.id}`,
        label: task.title,
        time: task.time,
        days: [],
        dates: [date],
        skipDates: [],
      });
    }
  }

  return { timezone: "Europe/Stockholm", reminders };
}
