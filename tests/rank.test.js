import assert from "node:assert/strict";
import test from "node:test";
import { levelFor } from "../src/economy.js";
import { rankForLevel, rankForXp, RANK_BANDS } from "../src/rank.js";

test("rank thresholds follow level bands E through S", () => {
  assert.equal(rankForLevel(1), "E");
  assert.equal(rankForLevel(2), "E");
  assert.equal(rankForLevel(3), "D");
  assert.equal(rankForLevel(5), "C");
  assert.equal(rankForLevel(7), "B");
  assert.equal(rankForLevel(9), "A");
  assert.equal(rankForLevel(10), "S");
  assert.equal(rankForXp(2800), "S");
  assert.equal(RANK_BANDS.length, 6);
  assert.equal(levelFor(0), 1);
});