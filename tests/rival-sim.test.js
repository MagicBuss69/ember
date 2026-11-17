import assert from "node:assert/strict";
import test from "node:test";
import { XP_WORKOUT } from "../src/constants.js";
import { createInitialState } from "../src/domain.js";
import { questXpForLevel, workoutXpForLevel } from "../src/economy.js";
import {
  RIVAL_WINDOWS,
  RIVALS,
  buildBoard,
  ensureRivalHistory,
  rivalEntryProgress,
  rivalPromptFacts,
  rivalWeekXp,
  simRivalDay,
  RIVAL_CATCHUP_CAP,
  RIVAL_GROWTH_CAP,
  rivalAttendance,
  rivalCatchUp,
  rivalDayTarget,
  rivalFloorDaily,
  rivalTotalXp,
  rivalStrength,
} from "../src/rivals.js";
import { addDays } from "../src/time.js";
import { totalXp } from "../src/stats.js";

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
        if (row.kind === "workout") assert.equal(row.xp, workoutXpForLevel(entry.level));
        else assert.equal(row.xp, questXpForLevel(entry.level));
      }
      if (entry.tasks >= 3 && slots.size >= 2) spread += 1;
      if (entry.completions.length >= 2) {
        const minutes = entry.completions.map((row) => row.minute);
        if (Math.max(...minutes) - Math.min(...minutes) >= 60) bursts += 1;
      }
      assert.ok(entry.tasks <= 14);
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

function userWithPace(perDay, days = 30, skipEvery = 0) {
  const state = createInitialState(new Date(`${addDays(TODAY, -days)}T12:00:00Z`));
  state.xpEvents = [];
  for (let i = 0; i <= days; i += 1) {
    if (skipEvery && i > 0 && i % skipEvery === 0) continue;
    const date = addDays(TODAY, -i);
    state.xpEvents.push({ id: `p${i}`, at: `${date}T12:00:00.000Z`, date, amount: perDay, source: "task", ref: `p${i}` });
  }
  return state;
}

function rivalSpan(state, id, from, to) {
  let sum = 0;
  for (let i = from; i <= to; i += 1) sum += Number(state.rivalDays[addDays(TODAY, -i)]?.byId?.[id]?.xp) || 0;
  return sum;
}

test("rivals keep pace with a hard-working user instead of stalling under a template day", () => {
  for (const perDay of [100, 250, 400]) {
    const state = userWithPace(perDay);
    ensureRivalHistory(state, TODAY, NOW);
    const mine = perDay * 21;
    const ratios = RIVALS.map((rival) => rivalSpan(state, rival.id, 1, 21) / mine);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    assert.ok(mean >= 1.8, `pace ${perDay}: mean rival ratio ${mean.toFixed(2)} should be about 2-3x the user`);
    RIVALS.forEach((rival, i) => {
      const want = rivalStrength(rival);
      assert.ok(ratios[i] >= want * 0.7, `pace ${perDay}: ${rival.id} ratio ${ratios[i].toFixed(2)} vs ${want}`);
      if (perDay >= 250) assert.ok(ratios[i] <= want * 1.45, `pace ${perDay}: ${rival.id} not absurdly far ahead (${ratios[i].toFixed(2)})`);
    });
  }
});

test("rival boosts: everyone 2x, the middle-low 2.5x, the lowest 3x", () => {
  const boosts = Object.fromEntries(RIVALS.map((rival) => [rival.id, rival.boost]));
  assert.deepEqual(boosts, { leo: 2, maja: 2.5, noah: 2, amina: 3 });
  for (const rival of RIVALS) assert.ok(rival.edge >= 0.95 && rival.edge <= 1.15, rival.id);
  const opts = { userLevel: 5, userAvg: 200, userDays: 7, daysIn: 0 };
  for (const rival of RIVALS) {
    const avg = rivalDayTarget(rival, opts) * rivalAttendance(rival);
    assert.ok(Math.abs(avg - 200 * rival.edge * rival.boost) < 0.01, rival.id);
    assert.equal(rivalStrength(rival), rival.edge * rival.boost);
  }
});

test("the boost replans today onward once, keeping past days and saved rival XP", () => {
  const state = userWithPace(200);
  delete state.grants.rivalBoostV3;
  ensureRivalHistory(state, TODAY, NOW);
  const pastKey = addDays(TODAY, -3);
  const past = structuredClone(state.rivalDays[pastKey]);
  const saved = structuredClone(state.rivalXp);
  delete state.grants.rivalBoostV3;
  state.rivalDays[TODAY].byId.amina = { xp: 1, rest: false, workout: false, quest: "x", minute: 480, tasks: 1 };
  ensureRivalHistory(state, TODAY, NOW);
  assert.equal(state.grants.rivalBoostV3, true);
  assert.deepEqual(state.rivalDays[pastKey], past);
  assert.deepEqual(state.rivalXp, saved);
  assert.notEqual(state.rivalDays[TODAY].byId.amina.xp, 1, "today was replanned with the boost");
  const again = structuredClone(state.rivalDays[TODAY]);
  ensureRivalHistory(state, TODAY, NOW);
  assert.deepEqual(state.rivalDays[TODAY], again, "only once, and deterministic");
});

test("with little history rivals use a floor tied to a perfect template week", () => {
  const fresh1 = createInitialState(NOW);
  ensureRivalHistory(fresh1, TODAY, NOW);
  for (const rival of RIVALS) {
    const withNone = rivalDayTarget(rival, { userLevel: 3 });
    const withTiny = rivalDayTarget(rival, { userLevel: 3, userAvg: 5, userDays: 6 });
    assert.equal(withNone, withTiny);
    assert.ok(withNone * rivalAttendance(rival) >= rivalFloorDaily(3) * rival.edge - 0.01);
  }
  const lowTotals = RIVALS.map((rival) => rivalTotalXp(fresh1, rival.id));
  assert.ok(lowTotals.every((total) => total > 0));
});

test("rivals grow harder over time, with a cap", () => {
  const leo = RIVALS[0];
  const opts = { userLevel: 3, userAvg: 120, userDays: 7 };
  const early = rivalDayTarget(leo, { ...opts, daysIn: 0 });
  const mid = rivalDayTarget(leo, { ...opts, daysIn: 40 });
  const late = rivalDayTarget(leo, { ...opts, daysIn: 400 });
  const capped = rivalDayTarget(leo, { ...opts, daysIn: 4000 });
  assert.ok(mid > early && late > mid);
  assert.equal(late, capped);
  assert.ok(Math.abs(late / early - (1 + RIVAL_GROWTH_CAP)) < 1e-9);
});

test("a rival who fell behind this past week pushes harder, within the cap", () => {
  const state = userWithPace(200);
  ensureRivalHistory(state, TODAY, NOW);
  const maja = RIVALS.find((rival) => rival.id === "maja");
  const recent = { avg: 200, days: 7 };
  const date = addDays(TODAY, 1);
  for (let i = 1; i <= 7; i += 1) state.rivalDays[addDays(date, -i)].byId.maja.xp = 0;
  assert.equal(rivalCatchUp(state, maja, date, recent), RIVAL_CATCHUP_CAP);
  for (let i = 1; i <= 7; i += 1) state.rivalDays[addDays(date, -i)].byId.maja.xp = 1000;
  assert.equal(rivalCatchUp(state, maja, date, recent), 1);
  assert.equal(rivalCatchUp(state, maja, date, { avg: null, days: 0 }), 1);
});

test("reopening after days away fills the gap and the rivals earned XP meanwhile", () => {
  const state = userWithPace(200, 40);
  const away = addDays(TODAY, -10);
  ensureRivalHistory(state, away, new Date(`${away}T12:00:00Z`));
  const before = RIVALS.map((rival) => rivalTotalXp(state, rival.id));
  ensureRivalHistory(state, TODAY, NOW);
  RIVALS.forEach((rival, index) => {
    assert.ok(rivalTotalXp(state, rival.id) > before[index], `${rival.id} gained while the app was closed`);
  });
  for (let i = 0; i <= 10; i += 1) assert.ok(state.rivalDays[addDays(TODAY, -i)], `day ${i} filled`);
});

test("one-time buff: old saves are redone this week and topped up to the user's level", () => {
  const state = userWithPace(300, 40);
  // An old save: rivals far behind, a stale plan for today and earlier this week.
  state.grants = { rivalXpV1: true };
  state.rivalXp = Object.fromEntries(RIVALS.map((rival) => [rival.id, 10]));
  state.rivalDays = {};
  for (let i = 0; i <= 20; i += 1) {
    const byId = Object.fromEntries(RIVALS.map((rival) => [rival.id, { xp: 20, rest: false, workout: false, quest: "x", minute: 480, tasks: 1 }]));
    state.rivalDays[addDays(TODAY, -i)] = { byId };
  }
  const stale = structuredClone(state.rivalDays[TODAY]);
  const staleOld = structuredClone(state.rivalDays[addDays(TODAY, -20)]);
  ensureRivalHistory(state, TODAY, NOW);
  assert.equal(state.grants.rivalBuffV2, true);
  assert.notDeepEqual(state.rivalDays[TODAY], stale, "today's stale plan was replanned");
  assert.deepEqual(state.rivalDays[addDays(TODAY, -20)], staleOld, "older frozen days are kept");
  const mine = totalXp(state);
  for (const rival of RIVALS) {
    assert.ok(rivalTotalXp(state, rival.id) >= Math.round(mine * rival.edge), `${rival.id} caught up to the user`);
  }
  const noah = rivalTotalXp(state, "noah");
  assert.ok(noah >= mine);
  // Idempotent: a second pass changes nothing.
  const snapshot = structuredClone({ days: state.rivalDays, xp: state.rivalXp });
  ensureRivalHistory(state, TODAY, NOW);
  assert.deepEqual({ days: state.rivalDays, xp: state.rivalXp }, snapshot);
});

test("one-time buff never takes XP from a rival who is already ahead", () => {
  const state = createInitialState(NOW);
  state.xpEvents = [{ id: "a", at: "2026-11-01T12:00:00.000Z", date: "2026-11-01", amount: 50, source: "task", ref: "a" }];
  state.rivalXp = { leo: 100000, maja: 0, noah: 0, amina: 0 };
  ensureRivalHistory(state, TODAY, NOW);
  assert.ok(state.rivalXp.leo >= 100000);
});

test("the board shows rivals with real week XP once their tasks are done", () => {
  const state = userWithPace(250);
  const board = buildBoard(state, NOW);
  const rivals = board.board.filter((row) => !row.you);
  const you = board.board.find((row) => row.you);
  assert.ok(rivals.every((row) => row.weekXp > 0));
  assert.ok(Math.max(...rivals.map((row) => row.weekXp)) >= you.weekXp * 0.8);
});
