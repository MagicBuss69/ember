import assert from "node:assert/strict";
import test from "node:test";
import { describeSameDay } from "../src/copy.js";
import { createInitialState } from "../src/domain.js";
import { XP_WORKOUT } from "../src/constants.js";
import { levelFor, questXpForLevel, workoutXpForLevel } from "../src/economy.js";
import {
  activityLine,
  buildBoard,
  ensureRivalHistory,
  rivalTotalXp,
  simRivalDay,
  tasksForRivalLevel,
  unit,
} from "../src/rivals.js";
import { addDays } from "../src/time.js";

const NOW = new Date("2026-11-13T20:00:00Z");

test("same-day copy matches the race the screen is built around", () => {
  const ahead = describeSameDay({ todayXp: 130, thenXp: 90, weekdayName: "Friday" });
  assert.equal(ahead.headline, "You're 40 XP ahead of last Friday's you.");
  assert.equal(ahead.tone, "ahead");
  const close = describeSameDay({ todayXp: 70, thenXp: 90, weekdayName: "Friday" });
  assert.match(close.detail, /One quest closes it/);
  const quiet = describeSameDay({ todayXp: 0, thenXp: 0, weekdayName: "Friday" });
  assert.equal(quiet.mode, "empty");
});

test("simulated partners are stable, uneven, and sometimes rest", () => {
  const state = createInitialState(NOW);
  ensureRivalHistory(state, "2026-11-13");
  const first = buildBoard(state, NOW);
  const second = buildBoard(structuredClone(state), NOW);
  assert.deepEqual(
    first.board.map((row) => [row.id, row.weekXp, row.streak]),
    second.board.map((row) => [row.id, row.weekXp, row.streak]),
  );
  const partners = first.board.filter((row) => !row.you);
  const scores = new Set(partners.map((row) => row.weekXp));
  assert.ok(scores.size >= 2, "weekly XP should not be a flat line");
  let rests = 0;
  let active = 0;
  for (const day of Object.values(state.rivalDays)) {
    for (const entry of Object.values(day.byId)) {
      if (entry.rest) rests += 1;
      else active += 1;
    }
  }
  assert.ok(rests > 20);
  assert.ok(active > 20);
  assert.ok(first.feed.length > 0);
  assert.equal(unit("leo:fixed"), unit("leo:fixed"));
  assert.notEqual(unit("leo"), unit("maja"));
});

test("activity lines sound like a person, including a fresh workout", () => {
  assert.equal(
    activityLine("Leo", { workout: true, quest: "Push session" }, 12),
    "Leo just finished a workout",
  );
  assert.match(activityLine("Maja", { workout: false, quest: "Focus block" }, 400), /Maja cleared/);
});

test("rival level comes from own xp ledger, not user level", () => {
  const state = createInitialState(NOW);
  state.rivalXp = { leo: 2000 };
  ensureRivalHistory(state, "2026-11-13");
  const board = buildBoard(state, NOW);
  const leo = board.board.find((row) => row.id === "leo");
  assert.equal(leo.level, levelFor(rivalTotalXp(state, "leo")));
  assert.notEqual(leo.level, board.board.find((row) => row.you).level);
});

test("tasks per active day scale with rival level", () => {
  assert.equal(tasksForRivalLevel(1), 1);
  assert.equal(tasksForRivalLevel(3), 1);
  assert.equal(tasksForRivalLevel(4), 2);
  assert.equal(tasksForRivalLevel(6), 2);
  assert.equal(tasksForRivalLevel(7), 3);
  assert.equal(tasksForRivalLevel(10), 4);
  const rival = { id: "leo", activity: 1, workoutRate: 0, mult: 1, swing: 1, quests: ["A"] };
  const l5 = simRivalDay(rival, "2026-01-01", 5);
  assert.equal(l5.tasks, 2);
  assert.ok(l5.xp >= 2 * questXpForLevel(5));
});

test("workout on rival day pays level-scaled workout xp", () => {
  let found = false;
  for (let i = 0; i < 40; i += 1) {
    const date = `2026-03-${String((i % 28) + 1).padStart(2, "0")}`;
    const entry = simRivalDay(
      { id: "noah", activity: 1, workoutRate: 1, mult: 1, swing: 0.5, quests: ["Run"] },
      date,
      3,
    );
    if (entry.workout) {
      found = true;
      assert.ok(entry.xp >= workoutXpForLevel(3));
      const without = simRivalDay(
        { id: "noah", activity: 1, workoutRate: 0, mult: 1, swing: 0.5, quests: ["Run"] },
        date,
        3,
      );
      assert.equal(entry.xp, without.xp + workoutXpForLevel(3));
      break;
    }
  }
  assert.ok(found);
});

test("pruning rivalDays rolls xp into rivalXp", () => {
  const state = createInitialState(NOW);
  ensureRivalHistory(state, "2026-11-13");
  const totalBefore = rivalTotalXp(state, "leo");
  state.rivalDays["2026-01-01"] = {
    byId: { leo: { xp: 77, rest: false, workout: false, quest: "x", minute: 480 } },
  };
  const extra = 77;
  ensureRivalHistory(state, "2026-11-13");
  assert.equal(rivalTotalXp(state, "leo"), totalBefore + extra);
});

test("a backfilled history does not invent XP for last Friday's you", () => {
  const state = createInitialState(NOW);
  const board = buildBoard(state, NOW);
  assert.equal(board.same.thenXp, 0);
  assert.equal(board.same.todayXp, 0);
  assert.equal(board.same.mode, "empty");
  assert.equal(addDays("2026-11-13", -7), board.same.thenDate);
});

test("rivals keep working when the user is past level 10", async () => {
  const { createInitialState } = await import("../src/domain.js");
  const { buildBoard } = await import("../src/rivals.js");
  const { levelStart } = await import("../src/economy.js");
  const now = new Date("2026-11-17T12:00:00+01:00");
  const state = createInitialState(new Date("2026-11-03T12:00:00+01:00"));
  state.xpEvents.push({ id: "big", at: now.toISOString(), date: "2026-11-10", amount: levelStart(18), source: "task", ref: "big" });
  const board = buildBoard(state, now);
  assert.ok(board.board.length >= 2);
  for (const row of board.board) assert.ok(Number.isFinite(row.weekXp));
});
