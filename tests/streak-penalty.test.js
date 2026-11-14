import assert from "node:assert/strict";
import test from "node:test";
import { SLOTS } from "../src/constants.js";
import { createInitialState, prepare, setTaskDone } from "../src/domain.js";
import {
  STREAK_BREAK_XP_PER_DAY,
  XP_PENALTY_PER_QUEST,
  currencyBlocked,
  mustDoQuestCount,
  openPenaltyQuests,
  streakBreakMustDoExtra,
  streakLostLength,
} from "../src/penalty.js";
import { penaltyHtml } from "../src/ui/screens.js";
import { streakCount, totalXp } from "../src/stats.js";

function completeOneQuest(state, date, when) {
  const task = state.days[date]?.slots?.morning?.[0];
  if (!task) return state;
  return setTaskDone(state, date, "morning", task.id, true, when);
}

test("losing a real streak applies full punishment pipeline", () => {
  let state = createInitialState(new Date("2026-11-22T08:00:00Z"));
  state.startedOn = "2026-11-15";
  state.penaltySince = "2026-11-15";
  const buildDays = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  for (const d of buildDays) {
    state = completeOneQuest(state, d, new Date(`${d}T12:00:00.000Z`));
  }
  assert.equal(streakCount(state, "2026-11-20"), 5);
  const missDay = "2026-11-21";
  const today = "2026-11-22";
  const xpBefore = totalXp(state);
  const prepared = prepare(state, new Date(`${today}T08:00:00.000Z`));
  const report = prepared.penaltyReport;
  assert.ok(report, "penalty report fires");
  assert.equal(streakCount(prepared.state, today), 0);
  assert.deepEqual(report.dates, [missDay]);
  assert.equal(report.streakLost, 5);
  assert.ok(report.streakXpLost > 0);
  assert.ok(report.streakXpLost <= 5 * STREAK_BREAK_XP_PER_DAY);
  assert.equal(report.streakMustDoAdded, streakBreakMustDoExtra(5));
  assert.equal(report.missMustDoAdded, mustDoQuestCount(1));
  assert.equal(report.mustDoAdded, report.missMustDoAdded + report.streakMustDoAdded);
  const incompleteOnMiss = (() => {
    const day = state.days[missDay];
    const total = SLOTS.reduce((n, slot) => n + (day.slots[slot]?.length || 0), 0);
    const done = SLOTS.reduce((n, slot) => n + (day.slots[slot]?.filter((t) => t.done).length || 0), 0);
    return total - done;
  })();
  const expectedXpDrop =
    incompleteOnMiss * XP_PENALTY_PER_QUEST + report.streakXpLost;
  assert.equal(report.xpLost, expectedXpDrop);
  assert.equal(totalXp(prepared.state), xpBefore - expectedXpDrop);
  assert.ok(currencyBlocked(prepared.state, today));
  assert.ok(openPenaltyQuests(prepared.state, today).length >= report.mustDoAdded);
  const html = penaltyHtml({ penaltyWindow: report });
  assert.match(html, /Streak broken/);
  assert.match(html, /Shard earnings stay frozen/i);
});

test("streak bonus scales with length of lost streak", () => {
  assert.equal(streakBreakMustDoExtra(0), 0);
  assert.equal(streakBreakMustDoExtra(2), 1);
  assert.equal(streakBreakMustDoExtra(5), 2);
  assert.equal(streakBreakMustDoExtra(10), 3);
  const state = createInitialState(new Date("2026-11-12T08:00:00Z"));
  assert.equal(streakLostLength(state, ["2026-11-11"]), 0);
  let built = createInitialState(new Date("2026-11-15T08:00:00Z"));
  built.startedOn = "2026-11-08";
  built = completeOneQuest(built, "2026-11-12", new Date("2026-11-12T12:00:00.000Z"));
  built = completeOneQuest(built, "2026-11-13", new Date("2026-11-13T12:00:00.000Z"));
  assert.equal(streakLostLength(built, ["2026-11-14"]), 2);
});