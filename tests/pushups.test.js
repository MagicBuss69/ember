import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, patchSettings, prepare } from "../src/domain.js";
import { sanitizeImport } from "../src/backup.js";
import {
  DEFAULT_UNLOCK_MINUTES,
  bestElbowAngle,
  clampUnlockMinutes,
  createRepCounter,
  elbowAngle,
  raisePushupMax,
  shouldGatePackage,
  stepRepCounter,
} from "../src/pushups.js";

function arm(angle, likelihood = 0.9) {
  const elbow = { x: 0, y: 0 };
  const shoulder = { x: 0, y: -1 };
  const rad = (angle * Math.PI) / 180;
  const wrist = { x: Math.sin(rad), y: -Math.cos(rad) };
  return { shoulder, elbow, wrist, likelihood };
}

test("elbow angle is straight up and bent at the bottom of a push-up", () => {
  const straight = elbowAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 });
  assert.ok(Math.abs(straight - 180) < 0.01);
  const bent = elbowAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.ok(Math.abs(bent - 90) < 0.01);
  assert.equal(elbowAngle(null, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
});

test("a rep counts only on a down-then-up, and a hidden arm is ignored", () => {
  let counter = createRepCounter();
  counter = stepRepCounter(counter, { left: arm(170), right: arm(170, 0.2) });
  assert.equal(counter.reps, 0);
  assert.equal(counter.phase, "up");
  counter = stepRepCounter(counter, { left: arm(80) });
  assert.equal(counter.phase, "down");
  assert.equal(counter.reps, 0);
  counter = stepRepCounter(counter, { left: arm(110) });
  assert.equal(counter.reps, 0, "halfway back up is not a rep");
  counter = stepRepCounter(counter, { left: arm(160) });
  assert.equal(counter.reps, 1);
  assert.equal(counter.phase, "up");
  counter = stepRepCounter(counter, { left: arm(40, 0.2), right: arm(40, 0.2) });
  assert.equal(counter.reps, 1, "low-confidence frames must not move the count");
  const preferred = bestElbowAngle({ left: arm(100, 0.6), right: arm(40, 0.95) });
  assert.ok(preferred < 60);
});

test("push-up gate blocks until an unlock, and quest mode is optional", () => {
  const packages = ["com.google.android.youtube"];
  assert.equal(DEFAULT_UNLOCK_MINUTES, 15);
  assert.equal(clampUnlockMinutes(0), 1);
  assert.equal(clampUnlockMinutes(30), 30);
  assert.equal(
    shouldGatePackage({ blockMode: "pushups", locked: true, packages, packageName: packages[0], unlockUntil: 0, now: 100 }),
    true,
  );
  assert.equal(
    shouldGatePackage({ blockMode: "pushups", locked: true, packages, packageName: packages[0], unlockUntil: 500, now: 100 }),
    false,
  );
  assert.equal(
    shouldGatePackage({ blockMode: "quests", locked: false, packages, packageName: packages[0], now: 100 }),
    false,
  );
  assert.equal(
    shouldGatePackage({ blockMode: "quests", locked: true, packages, packageName: packages[0], now: 100 }),
    true,
  );
  assert.equal(raisePushupMax(10, 12), 12);
  assert.equal(raisePushupMax(10, 8), 10);
});

test("unlock length defaults to 15 and a beaten max survives prepare", () => {
  let state = createInitialState(new Date("2026-11-13T20:00:00+01:00"));
  assert.equal(state.settings.blockMode, "pushups");
  assert.equal(state.settings.unlockMinutes, 15);
  state = patchSettings(state, { unlockMinutes: 20, pushupMax: 8, blockMode: "quests" });
  state.challengeInbox = [{ type: "pushup-max", reps: 11, max: 11 }];
  const prepared = prepare(state, new Date("2026-11-13T20:00:00+01:00"));
  assert.equal(prepared.state.settings.unlockMinutes, 20);
  assert.equal(prepared.state.settings.blockMode, "quests");
  assert.equal(prepared.state.settings.pushupMax, 11);
  const imported = sanitizeImport(structuredClone(prepared.state));
  assert.equal(imported.settings.unlockMinutes, 20);
  assert.equal(imported.settings.blockMode, "quests");
  assert.equal(imported.settings.pushupMax, 11);
});
