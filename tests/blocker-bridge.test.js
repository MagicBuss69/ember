import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockerSnapshot, DEFAULT_BLOCKED_PACKAGES } from "../src/blockerBridge.js";
import { createInitialState } from "../src/domain.js";

const NOW = new Date("2026-11-13T20:00:00+01:00");

test("blocker snapshot carries challenge fields and default packages", () => {
  const state = createInitialState(NOW);
  const snap = buildBlockerSnapshot(state, NOW);
  assert.equal(snap.locked, true);
  assert.equal(snap.blockMode, "pushups");
  assert.equal(snap.unlockMinutes, 15);
  assert.equal(snap.pushupMax, 10);
  assert.deepEqual(snap.packages, DEFAULT_BLOCKED_PACKAGES);
  assert.equal(snap.challengeActive, false);
  assert.equal(typeof snap.quiet, "boolean");
  assert.ok(snap.difficulty >= 1);
});