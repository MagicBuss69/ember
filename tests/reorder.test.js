import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeImport } from "../src/backup.js";
import {
  addTask,
  createInitialState,
  moveTask,
  moveTemplateTask,
  stepTask,
  stepTemplateTask,
} from "../src/domain.js";
import { drivePayload } from "../src/drive.js";
import { questTag, reminderRecords } from "../src/notify.js";
import { buildSchedule } from "../src/schedule.js";
import { addDays } from "../src/time.js";

const NOW = new Date("2026-11-14T09:00:00Z");
const TODAY = "2026-11-14";

test("moveTemplateTask and stepTemplateTask reorder within and across Morning/Afternoon/Evening slots", () => {
  let state = createInitialState(NOW);
  const wd = "1"; // Monday template: 2 morning, 1 afternoon, 2 evening
  const [m0, m1] = state.template[wd].morning;
  const [a0] = state.template[wd].afternoon;

  // Step m0 down once within Morning -> [m1, m0]
  state = stepTemplateTask(state, wd, "morning", m0.id, 1);
  assert.deepEqual(
    state.template[wd].morning.map((t) => t.id),
    [m1.id, m0.id],
  );

  // Step m0 down again -> crosses into top of Afternoon -> [m0, a0]
  state = stepTemplateTask(state, wd, "morning", m0.id, 1);
  assert.deepEqual(
    state.template[wd].morning.map((t) => t.id),
    [m1.id],
  );
  assert.deepEqual(
    state.template[wd].afternoon.map((t) => t.id),
    [m0.id, a0.id],
  );

  // Boundary clamp: stepping up from index 0 of Morning is a safe no-op
  const unchangedTop = stepTemplateTask(state, wd, "morning", m1.id, -1);
  assert.deepEqual(unchangedTop.template[wd], state.template[wd]);

  // Drag moveTemplateTask from Afternoon into Evening at index 1
  const [e0, e1] = state.template[wd].evening;
  state = moveTemplateTask(state, wd, "afternoon", m0.id, "evening", 1);
  assert.deepEqual(
    state.template[wd].evening.map((t) => t.id),
    [e0.id, m0.id, e1.id],
  );

  // Step up from top of Evening crosses back to end of Afternoon
  state = stepTemplateTask(state, wd, "evening", e0.id, -1);
  assert.deepEqual(
    state.template[wd].afternoon.map((t) => t.id),
    [a0.id, e0.id],
  );
});

test("reordering future Calendar days and Week days keeps reminders, questTag dedupe, and backups accurate", () => {
  let state = createInitialState(NOW);
  const futureDate = addDays(TODAY, 25); // 2026-12-09

  state = addTask(
    state,
    futureDate,
    "morning",
    { title: "Math presentation", why: "Room B12", time: "09:15", isEvent: true },
    NOW,
  );
  state = addTask(
    state,
    futureDate,
    "morning",
    { title: "Pack gym bag", why: "", time: "08:10", isEvent: false },
    NOW,
  );

  const [evTask, bagTask] = state.days[futureDate].slots.morning;

  // Move Event from Morning to Afternoon on the future Calendar day
  state = moveTask(state, futureDate, "morning", evTask.id, "afternoon", 0, NOW);
  assert.deepEqual(state.days[futureDate].slots.morning.map((t) => t.id), [bagTask.id]);
  assert.deepEqual(state.days[futureDate].slots.afternoon.map((t) => t.id), [evTask.id]);
  assert.equal(state.days[futureDate].slots.afternoon[0].isEvent, true);

  // Step pack-gym-bag down across empty Morning boundary into Afternoon top
  state = stepTask(state, futureDate, "morning", bagTask.id, 1, NOW);
  assert.equal(state.days[futureDate].slots.morning.length, 0);
  assert.deepEqual(
    state.days[futureDate].slots.afternoon.map((t) => t.id),
    [bagTask.id, evTask.id],
  );

  // Push schedule still contains both timed future reminders after section move
  const schedule = buildSchedule(state, TODAY);
  const schedPresentation = schedule.reminders.find((r) => r.label === "Math presentation");
  const schedBag = schedule.reminders.find((r) => r.label === "Pack gym bag");
  assert.ok(schedPresentation);
  assert.deepEqual(schedPresentation.dates, [futureDate]);
  assert.equal(schedPresentation.time, "09:15");
  assert.ok(schedBag);
  assert.deepEqual(schedBag.dates, [futureDate]);

  // Moving a timed quest on TODAY across sections updates local reminder slot label while preserving questTag
  const todayMorningTask = state.days[TODAY].slots.morning[0];
  state = moveTask(state, TODAY, "morning", todayMorningTask.id, "evening", 0, NOW);
  const localRecords = reminderRecords(state, NOW);
  const movedRec = localRecords.find((r) => r.taskId === todayMorningTask.id);
  assert.ok(movedRec);
  assert.match(movedRec.body, /^Evening · /);
  assert.equal(movedRec.tag, questTag(TODAY, todayMorningTask.time, todayMorningTask.title));

  // Reordered Template + Week + Calendar slots round-trip through Drive and JSON backup import
  state = moveTemplateTask(state, "1", "morning", state.template["1"].morning[0].id, "evening", 0);
  const expectedMonEveningFirst = state.template["1"].evening[0].title;
  const imported = sanitizeImport(JSON.parse(JSON.stringify(drivePayload(state))));
  assert.equal(imported.template["1"].evening[0].title, expectedMonEveningFirst);
  assert.deepEqual(
    imported.days[futureDate].slots.afternoon.map((t) => t.title),
    ["Pack gym bag", "Math presentation"],
  );
  assert.equal(imported.days[TODAY].slots.evening[0].id, todayMorningTask.id);
});
