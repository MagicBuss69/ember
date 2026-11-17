import assert from "node:assert/strict";
import test from "node:test";
import { CRYSTAL_FULL } from "../src/constants.js";
import { createInitialState, prepare, setTaskDone } from "../src/domain.js";
import { dayJustFinished, isComplete, isFullDay } from "../src/stats.js";

const SLOTS = ["morning", "afternoon", "evening"];
const DAY1 = "2026-11-16";
const DAY2 = "2026-11-17";
const AT1 = new Date("2026-11-16T19:00:00+01:00");
const AT2 = new Date("2026-11-17T08:00:00+01:00");

function tasksOf(state, date) {
  return SLOTS.flatMap((slot) => (state.days[date]?.slots?.[slot] || []).map((task) => ({ slot, id: task.id })));
}

function fullDayCount(state) {
  return state.crystalLog.filter((entry) => entry.reason === "full-day" && entry.delta > 0).length
    - state.crystalLog.filter((entry) => entry.reason === "full-day" && entry.delta < 0).length;
}

test("regression: after a finished day, one quest the next day is not 'day complete'", () => {
  let state = prepare(createInitialState(AT1), AT1).state;
  for (const task of tasksOf(state, DAY1)) state = setTaskDone(state, DAY1, task.slot, task.id, true, AT1);
  assert.ok(isFullDay(state, DAY1));
  assert.equal(fullDayCount(state), 1);

  // Next morning: the app rolls over, then the first quest gets checked.
  state = prepare(state, AT2).state;
  const day2 = tasksOf(state, DAY2);
  assert.ok(day2.length > 1);
  const before = state;
  state = setTaskDone(state, DAY2, day2[0].slot, day2[0].id, true, AT2);
  assert.ok(isComplete(state, DAY2), "one quest keeps the streak");
  assert.equal(dayJustFinished(before, state, DAY2), false, "but the day is not finished");
  assert.equal(fullDayCount(state), 1, "no second full-day reward yet");

  // Finishing every quest of day 2 is the moment it fires, and only then.
  let fired = 0;
  for (const task of day2.slice(1)) {
    const prev = state;
    state = setTaskDone(state, DAY2, task.slot, task.id, true, AT2);
    if (dayJustFinished(prev, state, DAY2)) fired += 1;
  }
  assert.equal(fired, 1);
  assert.equal(fullDayCount(state), 2);
  const crystalsFull = state.crystalLog.filter((entry) => entry.reason === "full-day").reduce((sum, entry) => sum + entry.delta, 0);
  assert.equal(crystalsFull, CRYSTAL_FULL * 2);

  // Re-running prepare on the same day never pays it twice.
  const again = prepare(state, AT2).state;
  assert.equal(fullDayCount(again), 2);
});
