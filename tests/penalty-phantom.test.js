import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, prepare } from "../src/domain.js";
import { migrateStateV2 } from "../src/migrate.js";
import { PENALTY_TAG, missedDatesBefore } from "../src/penalty.js";
import { rawGap } from "../src/stats.js";
import { SLOTS } from "../src/constants.js";

test("fresh install yesterday reports zero phantom missed days", () => {
  const install = new Date("2026-11-13T08:00:00Z");
  const state = createInitialState(install);
  const prepared = prepare(state, new Date("2026-11-14T08:00:00Z"));
  assert.equal(prepared.penaltyReport, null);
  assert.deepEqual(missedDatesBefore(prepared.state, "2026-11-14"), []);
  assert.deepEqual(rawGap(prepared.state, "2026-11-14"), []);
});

test("a real miss on the day after install still triggers penalties", () => {
  const install = new Date("2026-11-13T08:00:00Z");
  let state = createInitialState(install);
  const prepared = prepare(state, new Date("2026-11-15T08:00:00Z"));
  assert.ok(prepared.penaltyReport);
  assert.ok(prepared.penaltyReport.dates.includes("2026-11-14"));
  const today = "2026-11-15";
  const penalty = prepared.state.days[today].slots.morning.find((t) => t.penaltyTag === PENALTY_TAG);
  assert.ok(penalty);
});

test("phantom penalty migration clears bogus must-dos without touching XP", () => {
  const today = new Date("2026-11-14T08:00:00Z");
  let state = createInitialState(new Date("2026-11-13T08:00:00Z"));
  const xpBefore = (state.xpEvents || []).reduce((s, e) => s + e.amount, 0);
  state.penaltySince = "2026-11-10";
  state.penaltyProcessed = ["2026-11-10", "2026-11-11", "2026-11-12"];
  state.crystalStress = 0.9;
  state.streakBrokenAt = "2026-11-14";
  state.lastPenaltyReport = {
    id: "bogus",
    dates: ["2026-11-10", "2026-11-11", "2026-11-12"],
    questsMissed: 12,
    xpLost: 50,
    streakReset: true,
    mustDoAdded: 3,
  };
  const day = "2026-11-14";
  state.days[day].slots.morning.unshift({
    id: "md1",
    title: "Must-do: push-ups",
    why: "test",
    time: "07:00",
    done: false,
    doneAt: null,
    penaltyTag: PENALTY_TAG,
  });
  state.xpEvents.push({
    id: "keep",
    at: "2026-11-13T10:00:00.000Z",
    date: "2026-11-13",
    amount: 20,
    source: "task",
    ref: "t1",
  });
  state = migrateStateV2(state, today);
  const xpAfter = state.xpEvents.reduce((s, e) => s + e.amount, 0);
  assert.equal(xpAfter, xpBefore + 20);
  assert.equal(state.lastPenaltyReport, null);
  assert.ok(state.penaltySince >= "2026-11-13");
  assert.equal(state.crystalStress, 0);
  const open = SLOTS.flatMap((slot) => state.days[day].slots[slot]).some((t) => t.penaltyTag === PENALTY_TAG);
  assert.equal(open, false);
  assert.ok(state.grants.penaltyPhantomV1);
});