import assert from "node:assert/strict";
import test from "node:test";
import { describeSameDay } from "../src/copy.js";
import { createInitialState } from "../src/domain.js";
import { activityLine, buildBoard, ensureRivalHistory, unit } from "../src/rivals.js";
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

test("a backfilled history does not invent XP for last Friday's you", () => {
  const state = createInitialState(NOW);
  const board = buildBoard(state, NOW);
  assert.equal(board.same.thenXp, 0);
  assert.equal(board.same.todayXp, 0);
  assert.equal(board.same.mode, "empty");
  assert.equal(addDays("2026-11-13", -7), board.same.thenDate);
});
