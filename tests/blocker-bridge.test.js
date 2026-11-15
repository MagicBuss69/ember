import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockerSnapshot, DEFAULT_BLOCKED_PACKAGES } from "../src/blockerBridge.js";
import { openChallenge } from "../src/challenges.js";
import { createInitialState, setTaskDone } from "../src/domain.js";
import { challengeLiveHtml } from "../src/ui/screens.js";

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
  assert.equal(snap.challengeLabel, "");
  assert.equal(snap.challengeReps, 0);
  assert.equal(typeof snap.quiet, "boolean");
  assert.ok(snap.difficulty >= 1);
  assert.equal(challengeLiveHtml(state, NOW), "");
});

test("an open hourly challenge shows the exercise, reps, countdown, and Done", () => {
  let state = createInitialState(NOW);
  const today = "2026-11-13";
  for (const slot of ["morning", "afternoon", "evening"]) {
    for (const task of state.days[today].slots[slot]) {
      state = setTaskDone(state, today, slot, task.id, true, NOW);
    }
  }
  openChallenge(state, NOW, "notice-test");
  state.challenges.current.label = "Push-ups";
  state.challenges.current.reps = 20;
  state.challenges.current.isSeconds = false;
  const snap = buildBlockerSnapshot(state, NOW);
  assert.equal(snap.challengeActive, true);
  assert.equal(snap.challengeLabel, "Push-ups");
  assert.equal(snap.challengeReps, 20);
  assert.equal(snap.challengeIsSeconds, false);
  const html = challengeLiveHtml(state, NOW);
  assert.match(html, /Push-ups/);
  assert.match(html, /20/);
  assert.match(html, /data-challenge-countdown/);
  assert.match(html, /data-action="confirm-challenge"/);
  assert.match(html, />Done</);
  state.settings.quietNight = { on: true, start: "18:00", end: "23:00" };
  assert.equal(challengeLiveHtml(state, NOW), "");
});