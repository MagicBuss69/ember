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

test("levels never cap: level 10 keeps its old threshold and the curve keeps growing", async () => {
  const { levelFor, levelProgress, levelStart } = await import("../src/economy.js");
  assert.deepEqual(LEVEL_START, [0, 52, 152, 302, 502, 752, 1102, 1552, 2102, 2802]);
  assert.equal(levelFor(2801), 9);
  assert.equal(levelFor(2802), 10);
  assert.equal(levelFor(levelStart(11)), 11);
  assert.equal(levelFor(levelStart(11) - 1), 10);
  assert.equal(levelFor(1_000_000) > 50, true);
  let prev = xpSpanToNextLevel(9);
  for (let level = 10; level <= 80; level += 1) {
    const span = xpSpanToNextLevel(level);
    assert.ok(span > prev, `span grows at ${level}`);
    prev = span;
  }
  const at10 = levelProgress(2802 + 100);
  assert.equal(at10.level, 10);
  assert.equal(at10.maxed, false);
  assert.equal(at10.into, 100);
  assert.equal(at10.span, xpSpanToNextLevel(10));
  assert.ok(at10.pct > 0 && at10.pct < 1);
});

test("rewards keep scaling past 10, but slower than the XP curve", () => {
  assert.equal(questXpForLevel(11), 50);
  assert.ok(workoutXpForLevel(20) > workoutXpForLevel(10));
  const daysAt = (level) => xpSpanToNextLevel(level) / (questXpForLevel(level) * 5);
  assert.ok(daysAt(30) > daysAt(11));
});
