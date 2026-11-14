import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeImport } from "../src/backup.js";
import { addMonths, buildMonthGrid, daysInMonth, formatMonthLabel, monthKey } from "../src/calendar.js";
import { addTask, createInitialState, replaceDayFromTemplate, updateTask } from "../src/domain.js";
import { drivePayload } from "../src/drive.js";
import { dueReminders } from "../src/due.js";
import { questTag, reminderRecords } from "../src/notify.js";
import { SCHEDULE_HORIZON_DAYS, buildSchedule } from "../src/schedule.js";
import { addDays, weekdayIso } from "../src/time.js";

const NOW = new Date("2026-11-14T09:00:00Z");
const TODAY = "2026-11-14";

test("buildMonthGrid produces Monday-first full weeks, highlights today, and marks quests vs events", () => {
  assert.equal(monthKey(NOW), "2026-11");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(formatMonthLabel("2026-11"), "November 2026");

  let state = createInitialState(NOW);
  // Add a special one-off Event on 2026-11-24 (next week Tuesday, not yet materialized)
  state = addTask(
    state,
    "2026-11-24",
    "morning",
    { title: "Physics exam", why: "Bring calculator", time: "08:30", isEvent: true },
    NOW,
  );

  const nov = buildMonthGrid("2026-11", state, TODAY);
  assert.equal(nov.cells.length % 7, 0);
  // 2026-11-01 is Sunday, so Monday-first grid starts on Monday 2026-10-26 and ends Sunday 2026-12-06 (42 cells)
  assert.equal(nov.startKey, "2026-10-26");
  assert.equal(nov.endKey, "2026-12-06");
  assert.equal(nov.cells.length, 42);
  assert.equal(weekdayIso(nov.cells[0].date), 1);
  assert.equal(weekdayIso(nov.cells[nov.cells.length - 1].date), 7);

  const firstCell = nov.cells[0];
  assert.equal(firstCell.inMonth, false);
  assert.equal(firstCell.isPast, true);

  const todayCell = nov.cells.find((c) => c.date === TODAY);
  assert.ok(todayCell);
  assert.equal(todayCell.isToday, true);
  assert.equal(todayCell.inMonth, true);
  assert.equal(todayCell.hasQuests, true);
  assert.equal(todayCell.hasEvents, false);

  const examCell = nov.cells.find((c) => c.date === "2026-11-24");
  assert.ok(examCell);
  assert.equal(examCell.isFuture, true);
  assert.equal(examCell.hasEvents, true);
  assert.equal(examCell.eventCount, 1);
  assert.equal(examCell.questCount, 0);
});

test("future date creates on first add, preserves events when prefilling template, and round-trips through backup", () => {
  let state = createInitialState(NOW);
  const futureTue = "2026-12-08";
  assert.equal(state.days[futureTue], undefined);

  state = addTask(
    state,
    futureTue,
    "afternoon",
    { title: "Dentist", why: "Checkup", time: "14:15", isEvent: true },
    NOW,
  );
  assert.ok(state.days[futureTue]);
  assert.equal(state.days[futureTue].slots.afternoon.length, 1);
  assert.equal(state.days[futureTue].slots.afternoon[0].isEvent, true);
  assert.equal(state.crystals, 0);

  // Prefilling that weekday's template keeps the one-off Event alongside template quests
  state = replaceDayFromTemplate(state, futureTue, NOW);
  assert.ok(state.days[futureTue].slots.morning.length > 0);
  assert.ok(state.days[futureTue].slots.afternoon.some((t) => t.title === "Dentist" && t.isEvent));

  // Toggle isEvent via updateTask
  const dentist = state.days[futureTue].slots.afternoon.find((t) => t.title === "Dentist");
  const demoted = updateTask(
    state,
    futureTue,
    "afternoon",
    dentist.id,
    { title: dentist.title, why: dentist.why, time: dentist.time, slot: "afternoon", isEvent: false },
    NOW,
  );
  assert.equal(demoted.days[futureTue].slots.afternoon.find((t) => t.id === dentist.id).isEvent, false);

  // Export/Import + Drive backup preserve future day & isEvent; old tasks without isEvent default to false
  const driveCopy = drivePayload(state);
  const restored = sanitizeImport(JSON.parse(JSON.stringify(driveCopy)));
  assert.equal(
    restored.days[futureTue].slots.afternoon.find((t) => t.title === "Dentist").isEvent,
    true,
  );
  assert.equal(restored.days[TODAY].slots.morning[0].isEvent, false);
});

test("extended schedule horizon (>=60 days) schedules future one-off reminders and preserves today's local reminders", () => {
  assert.ok(SCHEDULE_HORIZON_DAYS >= 60);

  let state = createInitialState(NOW);
  const day45 = addDays(TODAY, 45); // 2026-12-29
  const day65 = addDays(TODAY, 65); // 2027-01-18

  state = addTask(
    state,
    day45,
    "morning",
    { title: "Train to Åre", why: "", time: "07:10", isEvent: true },
    NOW,
  );
  state = addTask(
    state,
    day65,
    "evening",
    { title: "Spring term kickoff", why: "", time: "18:45", isEvent: true },
    NOW,
  );

  const schedule = buildSchedule(state, TODAY);
  const rem45 = schedule.reminders.find((r) => r.label === "Train to Åre");
  const rem65 = schedule.reminders.find((r) => r.label === "Spring term kickoff");
  assert.ok(rem45, "45-day future reminder included");
  assert.deepEqual(rem45.dates, [day45]);
  assert.equal(rem45.time, "07:10");

  assert.ok(rem65, "65-day future reminder included");
  assert.deepEqual(rem65.dates, [day65]);
  assert.equal(rem65.time, "18:45");

  // Confirm Worker's dueReminders fires at 2027-01-18 18:45 Europe/Stockholm (17:45 UTC in winter CET)
  const due65 = dueReminders(schedule, new Date("2027-01-18T17:45:00Z"), {});
  assert.ok(due65.some((d) => d.label === "Spring term kickoff" && d.date === day65));

  // Template reminders on day65's weekday skip day65 since day65 was created without those template quests
  const wd65 = weekdayIso(day65);
  const tplOnWd = schedule.reminders.filter((r) => r.days.includes(wd65));
  assert.ok(tplOnWd.length > 0);
  for (const tplRem of tplOnWd) {
    assert.ok(tplRem.skipDates.includes(day65));
  }

  // Local reminderRecords still work for today with shared questTag dedupe
  const localToday = reminderRecords(state, NOW);
  assert.ok(localToday.length > 0);
  const firstToday = state.days[TODAY].slots.morning[0];
  assert.ok(
    localToday.some((rec) => rec.tag === questTag(TODAY, firstToday.time, firstToday.title)),
  );
});
