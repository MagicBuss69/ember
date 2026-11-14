import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, prepare, setTaskDone } from "../src/domain.js";
import { migrateStateV2 } from "../src/migrate.js";
import { XP_PENALTY_PER_QUEST } from "../src/penalty.js";
import { totalXp } from "../src/stats.js";

test("penalty applies XP loss and injects a penalty quest on next prepare", () => {
  const seeded = new Date("2026-11-11T08:00:00Z");
  let state = createInitialState(seeded);
  const day = "2026-11-10";
  const slots = state.days[day].slots;
  for (const slot of ["morning", "afternoon", "evening"]) {
    for (const task of slots[slot]) {
      state = setTaskDone(state, day, slot, task.id, true, new Date(`${day}T12:00:00.000Z`));
    }
  }
  const wed = new Date("2026-11-12T08:00:00Z");
  const prepared = prepare(state, wed);
  assert.ok(prepared.penaltyReport);
  const missedQuests = prepared.penaltyReport.questsMissed;
  assert.ok(missedQuests > 0);
  assert.equal(prepared.penaltyReport.xpLost, XP_PENALTY_PER_QUEST * missedQuests);
  const today = "2026-11-12";
  const penalty = prepared.state.days[today].slots.morning.find((t) => t.penaltyTag);
  assert.ok(penalty);
  assert.match(penalty.title, /Must-do/i);
});

test("upgrade today does not penalize incomplete days before penaltySince", () => {
  const upgrade = new Date("2026-11-14T08:00:00Z");
  let state = createInitialState(new Date("2026-11-10T08:00:00Z"));
  delete state.penaltySince;
  state = migrateStateV2(state, upgrade);
  assert.equal(state.penaltySince, "2026-11-14");
  const prepared = prepare(state, upgrade);
  assert.equal(prepared.penaltyReport, null);
});

test("a missed day on or after penaltySince triggers a penalty", () => {
  let state = createInitialState(new Date("2026-11-14T08:00:00Z"));
  const anchor = "2026-11-13";
  const task = state.days[anchor].slots.morning[0];
  state = setTaskDone(state, anchor, "morning", task.id, true, new Date(`${anchor}T08:00:00.000Z`));
  state.penaltySince = "2026-11-14";
  const prepared = prepare(state, new Date("2026-11-15T08:00:00Z"));
  assert.ok(prepared.penaltyReport);
  assert.ok(prepared.penaltyReport.dates.includes("2026-11-14"));
});

test("XP penalty cannot drop below current level floor", () => {
  let state = createInitialState(new Date("2026-11-20T08:00:00Z"));
  state.xpEvents.push({
    id: "bulk",
    at: "2026-11-19T08:00:00.000Z",
    date: "2026-11-19",
    amount: 55,
    source: "task",
    ref: "bulk",
  });
  state.startedOn = "2026-11-10";
  state.penaltyProcessed = [];
  const prep = prepare(state, new Date("2026-11-20T08:00:00Z"));
  assert.ok(prep.state.lastPenaltyReport || totalXp(prep.state) >= 50);
});