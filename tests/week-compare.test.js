import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { addDays, dateKey, weekStart } from "../src/time.js";
import { daysBetween, weekCompare, weekDailyXp } from "../src/stats.js";

test("weekDailyXp buckets XP into Mon–Sun columns", () => {
  const mon = weekStart("2026-11-10");
  let state = createInitialState(new Date("2026-11-13T12:00:00Z"));
  state = {
    ...state,
    xpEvents: [
      { date: "2026-11-10", amount: 25 },
      { date: "2026-11-12", amount: 50 },
      { date: "2026-11-17", amount: 99 },
    ],
  };
  const bars = weekDailyXp(state, mon, "2026-11-16");
  assert.equal(bars[daysBetween(mon, "2026-11-10")], 25);
  assert.equal(bars[daysBetween(mon, "2026-11-12")], 50);
  assert.equal(bars.reduce((a, b) => a + b, 0), 75);
});

test("weekCompare contrasts this week with the prior week", () => {
  const today = "2026-11-13";
  const thisStart = weekStart(today);
  let state = createInitialState(new Date("2026-11-13T12:00:00Z"));
  const lastStart = addDays(thisStart, -7);
  state = {
    ...state,
    xpEvents: [
      { date: today, amount: 75 },
      { date: addDays(today, -7), amount: 40 },
    ],
  };
  const idx = daysBetween(thisStart, today);
  const cmp = weekCompare(state, today);
  assert.equal(cmp.dayIndex, idx);
  assert.equal(cmp.sameDayDelta, 75 - 40);
  assert.equal(cmp.weekDelta, 75 - 40);
  assert.equal(cmp.lastStart, lastStart);
});