import assert from "node:assert/strict";
import test from "node:test";
import { LEVEL_START, questXpForLevel, workoutXpForLevel, xpSpanToNextLevel } from "../src/economy.js";

test("level thresholds increase each step", () => {
  for (let i = 1; i < LEVEL_START.length; i += 1) {
    assert.ok(LEVEL_START[i] > LEVEL_START[i - 1]);
  }
});

test("xp span to next level grows with level", () => {
  const a = xpSpanToNextLevel(1);
  const b = xpSpanToNextLevel(5);
  const c = xpSpanToNextLevel(8);
  assert.ok(b > a);
  assert.ok(c > b);
});

test("quest XP scales with player level", () => {
  assert.equal(questXpForLevel(1), 25);
  assert.equal(questXpForLevel(5), 35);
  assert.ok(questXpForLevel(10) > questXpForLevel(1));
});
test("workout XP scales with level exactly like quest XP", () => {
  assert.equal(workoutXpForLevel(1), 40);
  assert.equal(workoutXpForLevel(5), 56);
  assert.equal(workoutXpForLevel(10), 76);
  for (let level = 1; level <= 10; level += 1) {
    const ratio = workoutXpForLevel(level) / questXpForLevel(level);
    assert.ok(Math.abs(ratio - 1.6) < 0.05, `level ${level} ratio ${ratio}`);
  }
});
