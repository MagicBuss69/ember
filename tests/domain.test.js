import assert from "node:assert/strict";
import test from "node:test";
import { CRYSTAL_FULL, CRYSTAL_LEVEL, CRYSTAL_STREAK_DAY, XP_TASK, XP_WORKOUT } from "../src/constants.js";
import {
  addWorkout,
  applyTemplateToOpenDays,
  buyTheme,
  createInitialState,
  deleteTask,
  deleteWorkout,
  moveTask,
  prepare,
  setTaskDone,
  stepTask,
} from "../src/domain.js";
import { levelFor, levelProgress, workoutXpForLevel } from "../src/economy.js";
import { isFullDay, rawGap, streakCount, summarizeWeek, totalXp, weekPace, workoutHistory } from "../src/stats.js";
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
  state = setTaskDone(state, day, "afternoon", tasks[2].id, true, NOW);
  assert.ok(totalXp(state) >= 52);
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
  assert.equal(totalXp(state), 131);
  assert.equal(levelFor(totalXp(state)), 2);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY + CRYSTAL_LEVEL + CRYSTAL_FULL);
  state = setTaskDone(state, day, "evening", ordered[4][1].id, false, NOW);
  assert.equal(isFullDay(state, day), false);
  assert.equal(state.crystals, CRYSTAL_STREAK_DAY + CRYSTAL_LEVEL);
  assert.equal(totalXp(state), 103);
});

test("a missed day breaks streak without freezes", () => {
  let state = createInitialState(new Date("2026-11-11T08:00:00Z"));
  state.startedOn = "2026-11-10";
  const task = firstTask(state, "2026-11-10");
  state = setTaskDone(state, "2026-11-10", "morning", task.id, true, new Date("2026-11-10T08:00:00Z"));
  const prepared = prepare(state, new Date("2026-11-12T08:00:00Z"));
  assert.equal(streakCount(prepared.state, "2026-11-12"), 0);
  const gap = rawGap(prepared.state, "2026-11-12");
  assert.deepEqual(gap, ["2026-11-11"]);
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

test("workouts are date, type, split and note; pay XP once and count weekly", () => {
  let state = createInitialState(NOW);
  state = addWorkout(state, { name: "Push", kind: "strength", date: "2026-11-13", notes: "bench PR" }, NOW);
  state = addWorkout(state, { split: "Run", kind: "cardio", date: "2026-11-12" }, NOW);
  assert.equal(totalXp(state), XP_WORKOUT * 2);
  const saved = state.workouts.find((item) => item.name === "Push");
  assert.deepEqual(Object.keys(saved).sort(), ["createdAt", "date", "id", "kind", "name", "notes"]);
  assert.equal(saved.notes, "bench PR");
  const summary = summarizeWeek(state, "2026-11-13");
  assert.equal(summary.sessions, 2);
  assert.equal(summary.lifts, 1);
  assert.equal(summary.cardio, 1);
  const none = addWorkout(state, { name: "  ", kind: "strength", date: "2026-11-13" }, NOW);
  assert.equal(none.workouts.length, 2);
  const id = state.workouts[0].id;
  state = deleteWorkout(state, id, NOW);
  assert.equal(state.workouts.length, 1);
  assert.equal(totalXp(state), XP_WORKOUT);
});

test("old workouts with sets or minutes still load and show their name and note", () => {
  const state = createInitialState(NOW);
  state.workouts = [
    { id: "old1", date: "2026-11-10", name: "Bench press", kind: "strength", sets: [{ reps: 8, weightKg: 40 }], durationMin: null, distanceKm: null, notes: "felt strong", createdAt: "2026-11-10T12:00:00Z" },
    { id: "old2", date: "2026-11-11", name: "Run", kind: "cardio", sets: [], durationMin: 20, distanceKm: 3.2, notes: "", createdAt: "2026-11-11T12:00:00Z" },
  ];
  const ready = prepare(state, NOW).state;
  const history = workoutHistory(ready);
  assert.deepEqual(history.map((item) => item.split), ["Run", "Bench press"]);
  assert.equal(history[1].notes, "felt strong");
  assert.equal(history[1].kind, "strength");
  assert.equal(summarizeWeek(ready, "2026-11-13").sessions, 2);
});

test("workout XP scales with level like quest XP, and cardio keeps its saved kind", () => {
  let state = createInitialState(NOW);
  state.xpEvents.push({ id: "seed", at: NOW.toISOString(), date: "2026-11-13", amount: 700, source: "task", ref: "seed" });
  const level = levelFor(totalXp(state));
  assert.ok(level >= 5);
  const before = totalXp(state);
  state = addWorkout(state, { name: "Cardio", kind: "cardio", date: "2026-11-13", durationMin: 30 }, NOW);
  assert.equal(state.workouts[0].kind, "cardio");
  assert.equal(totalXp(state) - before, workoutXpForLevel(level));
  assert.ok(workoutXpForLevel(level) > XP_WORKOUT);
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

test("quests reorder within a slot and step across slots while keeping XP", () => {
  let state = createInitialState(NOW);
  const day = "2026-11-13";
  const [first, second] = state.days[day].slots.morning;
  state = setTaskDone(state, day, "morning", first.id, true, NOW);
  assert.equal(totalXp(state), XP_TASK);

  state = stepTask(state, day, "morning", first.id, 1, NOW);
  assert.equal(state.days[day].slots.morning[0].id, second.id);
  assert.equal(state.days[day].slots.morning[1].id, first.id);

  state = stepTask(state, day, "morning", first.id, 1, NOW);
  assert.equal(state.days[day].slots.morning.length, 1);
  assert.equal(state.days[day].slots.afternoon[0].id, first.id);

  state = moveTask(state, day, "afternoon", first.id, "evening", 99, NOW);
  const evening = state.days[day].slots.evening;
  assert.equal(evening[evening.length - 1].id, first.id);
  assert.equal(evening[evening.length - 1].done, true);
  assert.equal(totalXp(state), XP_TASK);
});

