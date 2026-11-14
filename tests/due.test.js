import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setTaskDone } from "../src/domain.js";
import { dueReminders } from "../src/due.js";
import { buildSchedule } from "../src/schedule.js";
import { dateKey } from "../src/time.js";

const monday730 = new Date("2026-11-16T06:30:00Z");

const schedule = {
  timezone: "Europe/Stockholm",
  reminders: [{ id: "a", label: "Outside", time: "07:30", days: [1], skipDates: [] }],
};

test("a reminder is due on its minute and weekday, and not twice", () => {
  assert.equal(dueReminders(schedule, monday730, {}).length, 1);
  assert.equal(dueReminders(schedule, new Date("2026-11-16T06:31:00Z"), {}).length, 1);
  assert.equal(dueReminders(schedule, new Date("2026-11-16T06:32:00Z"), {}).length, 0);
  assert.equal(dueReminders(schedule, new Date("2026-11-16T06:29:00Z"), {}).length, 0);
  assert.equal(dueReminders(schedule, new Date("2026-11-13T06:30:00Z"), {}).length, 0);
  const sent = { "a:2026-11-16:07:30": Date.now() };
  assert.equal(dueReminders(schedule, monday730, sent).length, 0);
  const skipped = {
    reminders: [{ id: "a", label: "Outside", time: "07:30", days: [1], skipDates: ["2026-11-16"] }],
  };
  assert.equal(dueReminders(skipped, monday730, {}).length, 0);
});

test("a one-off date fires only that day", () => {
  const once = {
    timezone: "Europe/Stockholm",
    reminders: [{ id: "once", label: "Dentist", time: "07:30", days: [], dates: ["2026-11-16"] }],
  };
  assert.equal(dueReminders(once, monday730, {}).length, 1);
  assert.equal(dueReminders(once, new Date("2026-11-23T06:30:00Z"), {}).length, 0);
});

test("finishing today's copy of a template quest skips that date", () => {
  const now = new Date("2026-11-13T08:00:00Z");
  let state = createInitialState(now);
  const today = dateKey(now);
  const task = state.days[today].slots.morning[0];
  state = setTaskDone(state, today, "morning", task.id, true, now);
  const built = buildSchedule(state, today);
  const match = built.reminders.find(
    (item) => item.label === task.title && item.time === task.time && item.days.includes(5),
  );
  assert.ok(match);
  assert.ok(match.skipDates.includes(today));
  assert.equal(built.timezone, "Europe/Stockholm");
});
