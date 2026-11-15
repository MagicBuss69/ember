import assert from "node:assert/strict";
import test from "node:test";
import { XP_WORKOUT } from "../src/constants.js";
import { createInitialState } from "../src/domain.js";
import { questXpForLevel } from "../src/economy.js";
import {
  RIVAL_WINDOWS,
  RIVALS,
  buildBoard,
  ensureRivalHistory,
  rivalEntryProgress,
  rivalPromptFacts,
  rivalWeekXp,
  simRivalDay,
  templateQuestCount,
} from "../src/rivals.js";
import { addDays } from "../src/time.js";

const NOW = new Date("2026-11-13T20:00:00Z");
const TODAY = "2026-11-13";

function fresh(now = NOW) {
  const state = createInitialState(now);
  ensureRivalHistory(state, TODAY, now);
  return state;
}

test("a rival day is seeded: the same date replays the same plan", () => {
  const a = simRivalDay(RIVALS[0], "2026-11-13", 4, { userLevel: 3 });
  const b = simRivalDay(RIVALS[0], "2026-11-13", 4, { userLevel: 3 });
  assert.deepEqual(a, b);
  const other = simRivalDay(RIVALS[1], "2026-11-13", 4, { userLevel: 3 });
  assert.notDeepEqual(a.completions, other.completions);
});

test("reopening does not reroll stored history, and a gap is filled once", () => {
  const early = new Date("2026-11-08T18:00:00Z");
  const state = createInitialState(early);
  ensureRivalHistory(state, "2026-11-08", early);
  const frozen = structuredClone(state.rivalDays["2026-11-08"]);
  assert.ok(frozen);
  ensureRivalHistory(state, TODAY, NOW);
  assert.deepEqual(state.rivalDays["2026-11-08"], frozen);
  assert.ok(state.rivalDays[TODAY]);
  const again = structuredClone(state.rivalDays);
  ensureRivalHistory(state, TODAY, NOW);
  assert.deepEqual(state.rivalDays, again);
});

test("task XP matches the user quest formula and lands in daypart bursts", () => {
  const state = fresh();
  let bursts = 0;
  let spread = 0;
  for (const [date, day] of Object.entries(state.rivalDays)) {
    for (const entry of Object.values(day.byId)) {
      if (entry.rest) continue;
      assert.ok(Array.isArray(entry.completions));
      assert.equal(
        entry.xp,
        entry.completions.reduce((sum, row) => sum + row.xp, 0),
      );
      const slots = new Set();
      for (const row of entry.completions) {
        const [start, end] = RIVAL_WINDOWS[row.slot];
        assert.ok(row.minute >= start && row.minute <= end, `${row.slot} ${row.minute}`);
        slots.add(row.slot);
        if (row.kind === "workout") assert.equal(row.xp, XP_WORKOUT);
        else assert.equal(row.xp, questXpForLevel(entry.level));
      }
      if (entry.tasks >= 3 && slots.size >= 2) spread += 1;
      if (entry.completions.length >= 2) {
        const minutes = entry.completions.map((row) => row.minute);
        if (Math.max(...minutes) - Math.min(...minutes) >= 60) bursts += 1;
      }
      assert.ok(entry.tasks <= templateQuestCount(date));
    }
  }
  assert.ok(spread > 10, "multi-task days should cover more than one part of the day");
  assert.ok(bursts > 10, "completions should be separated, not one instant jump");
});

test("earned XP steps forward through the day and ignores future tasks", () => {
  const state = fresh();
  const morning = new Date("2026-11-13T06:05:00Z");
  const evening = new Date("2026-11-13T20:00:00Z");
  let stepped = 0;
  for (const rival of RIVALS) {
    const entry = state.rivalDays[TODAY].byId[rival.id];
    if (!entry?.completions?.length) continue;
    const early = rivalEntryProgress(entry, TODAY, TODAY, morning);
    const late = rivalEntryProgress(entry, TODAY, TODAY, evening);
    assert.ok(early.xp <= late.xp);
    assert.ok(late.tasksDone <= entry.tasks);
    if (late.xp > early.xp) stepped += 1;
    const future = entry.completions.filter((row) => row.minute > 7 * 60 + 5);
    if (future.length) {
      assert.ok(early.tasksDone < entry.tasks || early.xp < entry.xp);
    }
  }
  assert.ok(stepped >= 1);
  const weekEarly = rivalWeekXp(state, "leo", TODAY, morning);
  const weekLate = rivalWeekXp(state, "leo", TODAY, evening);
  assert.ok(weekLate >= weekEarly);
});

test("personalities miss days, break streaks, and do not all look alike", () => {
  const state = fresh();
  const rests = { leo: 0, maja: 0, noah: 0, amina: 0 };
  const taskCounts = { leo: [], maja: [], noah: [], amina: [] };
  let breaks = 0;
  for (const rival of RIVALS) {
    const dates = Object.keys(state.rivalDays).sort();
    let run = 0;
    for (const date of dates) {
      const entry = state.rivalDays[date].byId[rival.id];
      if (entry.rest || !(entry.xp > 0)) {
        rests[rival.id] += 1;
        if (run >= 3) breaks += 1;
        run = 0;
      } else {
        run += 1;
        taskCounts[rival.id].push(entry.tasks);
      }
    }
  }
  assert.ok(rests.maja > rests.noah, "Maja misses more days than Noah");
  assert.ok(rests.leo > 0 && rests.amina > 0);
  assert.ok(breaks >= 1, "someone should break a streak of 3+");
  const spread = (id) => {
    const rows = taskCounts[id];
    return Math.max(...rows) - Math.min(...rows);
  };
  assert.ok(spread("maja") >= spread("noah"));
  assert.ok(spread("maja") >= 1);
});

function tasksOnToday(events) {
  const state = createInitialState(NOW);
  state.startedOn = "2026-10-01";
  state.xpEvents = events;
  ensureRivalHistory(state, TODAY, NOW);
  delete state.rivalDays[TODAY];
  ensureRivalHistory(state, TODAY, NOW);
  return Object.fromEntries(RIVALS.map((rival) => [rival.id, state.rivalDays[TODAY].byId[rival.id].tasks]));
}

test("a perfect template week still beats every rival, and slacking lets them schedule more", () => {
  const state = fresh();
  const board = buildBoard(state, NOW);
  // Friday night: Mon–Fri of a perfect template, before the weekend exists.
  const perfectSoFar = 5 * 5 * questXpForLevel(1);
  for (const row of board.board) {
    if (row.you) continue;
    assert.ok(row.weekXp < perfectSoFar, `${row.id} week ${row.weekXp} should be under ${perfectSoFar}`);
  }
  const top = Math.max(...board.board.filter((row) => !row.you).map((row) => row.weekXp));
  assert.ok(top > perfectSoFar * 0.55, `top rival week ${top} should still be a race`);

  const lump = {
    id: "lump",
    at: "2026-10-20T12:00:00.000Z",
    date: "2026-10-20",
    amount: 900,
    source: "task",
    ref: "lump",
  };
  const slack = tasksOnToday([lump]);
  const recent = [];
  for (let i = 1; i <= 7; i += 1) {
    recent.push({
      id: `grind-${i}`,
      at: `${addDays(TODAY, -i)}T12:00:00.000Z`,
      date: addDays(TODAY, -i),
      amount: 100,
      source: "task",
      ref: `grind-${i}`,
    });
  }
  const grinding = tasksOnToday([{ ...lump, amount: 200 }, ...recent]);
  let eased = 0;
  for (const rival of RIVALS) {
    assert.ok(slack[rival.id] >= grinding[rival.id], `${rival.id} slack ${slack[rival.id]} grind ${grinding[rival.id]}`);
    if (slack[rival.id] > grinding[rival.id]) eased += 1;
  }
  assert.ok(eased >= 1, "a slacking week should raise at least one rival's task count");
});

test("rival chat facts use the tasks and streak the board is showing", () => {
  const state = fresh();
  const facts = rivalPromptFacts(state, "leo", NOW);
  const entry = state.rivalDays[TODAY].byId.leo;
  const progress = rivalEntryProgress(entry, TODAY, TODAY, NOW);
  assert.equal(facts.todayTasksDone, progress.tasksDone);
  assert.equal(facts.todayTasksPlanned, progress.tasksPlanned);
  assert.equal(facts.todayXp, progress.xp);
  assert.ok(Array.isArray(facts.recentActivity));
  assert.ok(facts.recentActivity.length >= 1);
  assert.match(facts.recentActivity[0], /2026-11-13/);
});
