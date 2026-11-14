import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, prepare, setTaskDone } from "../src/domain.js";
import { currencyBlocked, mustDoQuestCount, PENALTY_TAG } from "../src/penalty.js";

test("must-do quest count scales with missed days", () => {
  assert.equal(mustDoQuestCount(1), 1);
  assert.equal(mustDoQuestCount(2), 3);
  assert.equal(mustDoQuestCount(4), 6);
});

test("open must-do penalties freeze shard earnings", () => {
  let state = createInitialState(new Date("2026-11-14T08:00:00Z"));
  state.penaltySince = "2026-11-14";
  const day = "2026-11-13";
  const task = state.days[day].slots.morning[0];
  state = setTaskDone(state, day, "morning", task.id, true, new Date(`${day}T08:00:00.000Z`));
  const prepared = prepare(state, new Date("2026-11-15T08:00:00Z"));
  const today = "2026-11-15";
  assert.ok(currencyBlocked(prepared.state, today));
  const before = prepared.state.crystals;
  const penalty = prepared.state.days[today].slots.morning.find((t) => t.penaltyTag === PENALTY_TAG);
  const normal = prepared.state.days[today].slots.morning.find((t) => !t.penaltyTag);
  assert.ok(penalty);
  if (normal) {
    const after = setTaskDone(prepared.state, today, "morning", normal.id, true, new Date("2026-11-15T09:00:00.000Z"));
    assert.equal(after.crystals, before);
  }
});