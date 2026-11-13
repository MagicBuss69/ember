import assert from "node:assert/strict";
import test from "node:test";
import { CRYSTAL_FULL, CRYSTAL_LEVEL, CRYSTAL_STREAK_DAY, FREEZE_PRICE, XP_TASK, XP_WORKOUT } from "../src/constants.js";
import {
  addWorkout,
  applyTemplateToOpenDays,
  buyFreeze,
  buyTheme,
  createInitialState,
  deleteTask,
  deleteWorkout,
  prepare,
  setTaskDone,
} from "../src/domain.js";
import { levelFor, levelProgress } from "../src/economy.js";
import { isFullDay, rawGap, streakCount, summarizeWeek, totalXp, weekPace } from "../src/stats.js";
import { dateKey } from "../src/time.js";

const NOW = new Date("2026-11-13T18:00:00Z");

function firstTask(state, date, slot = "morning") {
  return state.days[date].slots[slot][0];
}

test("starter Friday has five quests and Saturday has three", () => {
  const state = createInitialState(NOW);
  assert.equal(dateKey(NOW), "2026-11-13");
  assert.equal(
    ["morning", "afternoon", "evening"].reduce((n, slot) => n + state.days["2026-11-13"].slots[slot].length, 0),
    5,
  );
  assert.equal(
    ["morning", "afternoon", "evening"].reduce((n, slot) => n + state.days["2026-11-14"].slots[slot].length, 0),
    3,
  );
});

test("two quests reach level 2 and pay level crystals once", () => {
  let state = createInitialState(NOW);
  const day = "2026-11-13";
  const tasks = [
    ...state.days[day].slots.morning,
    ...state.days[day].slots.afternoon,
    ...state.days[day].slots.evening,
  ];
  state = setTaskDone(state, day, "morning", tasks[0].id, true, NOW);
  assert.equal(totalXp(state), XP_TASK);
  assert.equal(levelFor(totalXp(state)), 1);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY);
  state = setTaskDone(state, day, "morning", tasks[1].id, true, NOW);
  assert.equal(totalXp(state), XP_TASK * 2);
  assert.equal(levelFor(totalXp(state)), 2);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY + CRYSTAL_LEVEL);
  const again = prepare(state, NOW).state;
  assert.equal(again.crystals, state.crystals);
  assert.equal(levelProgress(totalXp(again)).level, 2);
});

test("a full day pays crystals and unchecking claws them back", () => {
  let state = createInitialState(NOW);
  const day = "2026-11-13";
  const slots = state.days[day].slots;
  const ordered = [
    ["morning", slots.morning[0]],
    ["morning", slots.morning[1]],
    ["afternoon", slots.afternoon[0]],
    ["evening", slots.evening[0]],
    ["evening", slots.evening[1]],
  ];
  for (const [slot, task] of ordered) state = setTaskDone(state, day, slot, task.id, true, NOW);
  assert.equal(isFullDay(state, day), true);
  assert.equal(totalXp(state), 125);
  assert.equal(levelFor(125), 2);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY + CRYSTAL_LEVEL + CRYSTAL_FULL);
  state = setTaskDone(state, day, "evening", ordered[4][1].id, false, NOW);
  assert.equal(isFullDay(state, day), false);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY + CRYSTAL_LEVEL);
  assert.equal(totalXp(state), 100);
});

test("a freeze covers one missed day and is not wasted on a longer gap", () => {
  let state = createInitialState(new Date("2026-11-11T08:00:00Z"));
  const monday = firstTask(state, "2026-11-09");
  state = setTaskDone(state, "2026-11-09", "morning", monday.id, true, new Date("2026-11-09T08:00:00Z"));
  state.freezes = 1;
  const wed = new Date("2026-11-11T08:00:00Z");
  const prepared = prepare(state, wed);
  assert.equal(prepared.freezesUsed.length, 1);
  assert.equal(prepared.freezesUsed[0].date, "2026-11-10");
  assert.equal(prepared.state.freezes, 0);
  assert.equal(streakCount(prepared.state, "2026-11-11"), 1);
  const again = prepare(prepared.state, wed);
  assert.equal(again.freezesUsed.length, 0);

  let broken = createInitialState(wed);
  const mon = firstTask(broken, "2026-11-09");
  broken = setTaskDone(broken, "2026-11-09", "morning", mon.id, true, new Date("2026-11-09T08:00:00Z"));
  broken.days["2026-11-10"].slots.morning.forEach((task) => {
    task.done = false;
  });
  broken.days["2026-11-11"].slots.morning.forEach((task) => {
    task.done = false;
  });
  broken.freezes = 1;
  const gap = rawGap(broken, "2026-11-12");
  assert.deepEqual(gap, ["2026-11-10", "2026-11-11"]);
  const saved = prepare(broken, new Date("2026-11-12T08:00:00Z"));
  assert.equal(saved.freezesUsed.length, 0);
  assert.equal(saved.state.freezes, 1);
  assert.equal(streakCount(saved.state, "2026-11-12"), 0);
});

test("buying a freeze repairs a one-day gap", () => {
  let state = createInitialState(new Date("2026-11-11T08:00:00Z"));
  const monday = firstTask(state, "2026-11-09");
  state = setTaskDone(state, "2026-11-09", "morning", monday.id, true, new Date("2026-11-09T08:00:00Z"));
  state.crystals = FREEZE_PRICE;
  const bought = buyFreeze(state, new Date("2026-11-11T08:00:00Z"));
  assert.equal(bought.ok, true);
  assert.equal(bought.state.freezes, 0);
  assert.ok(bought.state.freezeLog.some((entry) => entry.date === "2026-11-10"));
  assert.equal(streakCount(bought.state, "2026-11-11"), 1);
});

test("themes spend crystals and cannot be equipped before purchase", () => {
  let state = createInitialState(NOW);
  state.crystals = 10;
  const bought = buyTheme(state, "pine", NOW);
  assert.equal(bought.ok, true);
  assert.equal(bought.state.settings.theme, "pine");
  assert.equal(bought.state.crystals, 0);
  const poor = buyTheme(bought.state, "ink", NOW);
  assert.equal(poor.ok, false);
  assert.equal(poor.state.settings.theme, "pine");
});

test("workouts pay XP once and count weekly volume", () => {
  let state = createInitialState(NOW);
  state = addWorkout(
    state,
    {
      name: "Bench press",
      kind: "strength",
      date: "2026-11-13",
      sets: [
        { reps: 8, weightKg: 40 },
        { reps: 6, weightKg: 42.5 },
      ],
    },
    NOW,
  );
  state = addWorkout(
    state,
    { name: "Run", kind: "cardio", date: "2026-11-12", durationMin: 20, distanceKm: 3.2, sets: [] },
    NOW,
  );
  assert.equal(totalXp(state), XP_WORKOUT * 2);
  const summary = summarizeWeek(state, "2026-11-13");
  assert.equal(summary.sessions, 2);
  assert.equal(summary.sets, 2);
  assert.equal(summary.volume, 8 * 40 + 6 * 42.5);
  assert.equal(summary.km, 3.2);
  const id = state.workouts[0].id;
  state = deleteWorkout(state, id, NOW);
  assert.equal(state.workouts.length, 1);
  assert.equal(totalXp(state), XP_WORKOUT);
});

test("backfilled last-Friday XP counts toward last week's pace", () => {
  const state = createInitialState(NOW);
  state.xpEvents.push(
    {
      id: "old",
      at: "2026-11-13T18:05:00.000Z",
      date: "2026-11-06",
      amount: 50,
      source: "task",
      ref: "old",
    },
    {
      id: "now",
      at: "2026-11-13T17:50:00.000Z",
      date: "2026-11-13",
      amount: 90,
      source: "task",
      ref: "now",
    },
  );
  const pace = weekPace(state, "2026-11-13", NOW);
  assert.equal(pace.paceXp, 50);
  assert.equal(pace.thisXp, 90);
  assert.equal(pace.hasHistory, true);
});

test("template fill skips a day that already has a finished quest", () => {
  let state = createInitialState(NOW);
  const task = firstTask(state, "2026-11-13");
  state = setTaskDone(state, "2026-11-13", "morning", task.id, true, NOW);
  state = deleteTask(state, "2026-11-14", "morning", state.days["2026-11-14"].slots.morning[0].id, NOW);
  const filled = applyTemplateToOpenDays(state, "2026-11-13", NOW);
  assert.equal(filled.state.days["2026-11-13"].slots.morning[0].title, task.title);
  assert.equal(filled.state.days["2026-11-13"].slots.morning[0].done, true);
  assert.ok(filled.state.days["2026-11-14"].slots.morning.length > 0);
});
