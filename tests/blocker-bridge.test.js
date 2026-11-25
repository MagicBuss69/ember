import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockerSnapshot, DEFAULT_BLOCKED_PACKAGES, restoreChallengeFromSnapshot } from "../src/blockerBridge.js";
import { normalizeBlockedPackages, openChallenge, processChallenges } from "../src/challenges.js";
import { createInitialState, patchSettings, setTaskDone } from "../src/domain.js";
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
  processChallenges(state, NOW);
  assert.ok(buildBlockerSnapshot(state, NOW).nextRollAt);
  assert.ok(snap.difficulty >= 1);
  assert.equal(challengeLiveHtml(state, NOW), "");
});

test("a saved empty block list stays empty, and duplicates are dropped", () => {
  let state = createInitialState(NOW);
  state = patchSettings(state, {
    blockedPackages: ["com.zed", "com.zed", " se.ember.app ", "com.alpha", ""],
    blockedPackagesChosen: true,
    blockedPackageLabels: { "com.zed": "Zed", "com.alpha": "Alpha" },
  });
  assert.deepEqual(state.settings.blockedPackages, ["com.zed", "com.alpha"]);
  assert.equal(state.settings.blockedPackageLabels["com.zed"], "Zed");
  assert.deepEqual(normalizeBlockedPackages(["com.zed", "com.zed"]), ["com.zed"]);
  assert.deepEqual(buildBlockerSnapshot(state, NOW).packages, ["com.zed", "com.alpha"]);
  const cleared = patchSettings(state, { blockedPackages: [], blockedPackagesChosen: true });
  assert.deepEqual(buildBlockerSnapshot(cleared, NOW).packages, []);
  assert.equal(createInitialState(NOW).settings.blockedPackagesChosen, false);
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

test("a native snapshot puts the exercise back when the web view has none", () => {
  const now = new Date("2026-11-13T20:00:00+01:00");
  const state = createInitialState(now);
  const deadline = new Date(now.getTime() + 8 * 60 * 1000).toISOString();
  const restored = restoreChallengeFromSnapshot(state, {
    challengeActive: true,
    challengeLabel: "Squats",
    challengeReps: 15,
    challengeDeadline: deadline,
    challengeId: "ch-1",
    quiet: false,
  }, now);
  assert.equal(restored.challenges.current.label, "Squats");
  assert.equal(restored.challenges.current.reps, 15);
  const html = challengeLiveHtml(restored, now);
  assert.match(html, /Squats/);
  assert.match(html, />15</);
  assert.match(html, /data-challenge-countdown/);
  assert.match(html, />Done</);
  assert.equal(restoreChallengeFromSnapshot(state, {
    challengeActive: true,
    challengeLabel: "Squats",
    challengeReps: 15,
    challengeDeadline: deadline,
    quiet: true,
  }, now).challenges.current, null);
  assert.equal(restoreChallengeFromSnapshot(state, {
    challengeActive: true,
    challengeLabel: "Squats",
    challengeReps: 15,
    challengeDeadline: new Date(now.getTime() - 1000).toISOString(),
  }, now).challenges.current, null);
});