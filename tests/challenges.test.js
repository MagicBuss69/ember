import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChallengeInbox,
  confirmChallenge,
  isFullDayQuests,
  isQuietHour,
  openChallenge,
  pickChallenge,
  processChallenges,
  quietEndsAt,
  resolveChallengeMiss,
  ROLL_MIN_MS,
} from "../src/challenges.js";
import { createInitialState, patchSettings, prepare, setTaskDone } from "../src/domain.js";
import { sanitizeImport } from "../src/backup.js";
import { totalXp } from "../src/stats.js";
import { migrateStateV2 } from "../src/migrate.js";
import { SLOTS } from "../src/constants.js";

const SCHOOL_FRIDAY = new Date("2026-11-13T09:00:00+01:00");
const NIGHT_LATE = new Date("2026-11-13T23:30:00+01:00");
const NIGHT_EARLY = new Date("2026-11-13T05:00:00+01:00");
const OPEN_EVENING = new Date("2026-11-13T20:00:00+01:00");

function stateWithXp(now) {
  let state = createInitialState(now);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  state = setTaskDone(state, today, "morning", task.id, true, now);
  assert.ok(totalXp(state) > 0);
  return state;
}

test("quiet hours cover school weekdays and wrap night past midnight", () => {
  const state = createInitialState(SCHOOL_FRIDAY);
  assert.equal(isQuietHour(SCHOOL_FRIDAY, state.settings), true);
  assert.equal(isQuietHour(NIGHT_LATE, state.settings), true);
  assert.equal(isQuietHour(NIGHT_EARLY, state.settings), true);
  assert.equal(isQuietHour(OPEN_EVENING, state.settings), false);
  const endNight = quietEndsAt(NIGHT_LATE, state.settings);
  assert.ok(endNight > NIGHT_LATE.getTime());
  const endEarly = quietEndsAt(NIGHT_EARLY, state.settings);
  assert.ok(endEarly > NIGHT_EARLY.getTime());
});

test("challenge roll waits until quiet ends", () => {
  const state = createInitialState(SCHOOL_FRIDAY);
  state.challenges.nextRollAt = new Date(SCHOOL_FRIDAY.getTime() - 1000).toISOString();
  const { events } = processChallenges(state, SCHOOL_FRIDAY);
  assert.ok(events.some((e) => e.type === "roll-delayed-quiet"));
  assert.ok(new Date(state.challenges.nextRollAt).getTime() > SCHOOL_FRIDAY.getTime());
});

test("open challenge expires with xp penalty and bumps difficulty step", () => {
  const state = stateWithXp(OPEN_EVENING);
  const before = totalXp(state);
  openChallenge(state, new Date(OPEN_EVENING.getTime() - 12 * 60 * 1000), "test");
  const id = state.challenges.current.id;
  const at = new Date(state.challenges.current.deadlineAt);
  at.setMilliseconds(at.getMilliseconds() + 1);
  assert.ok(resolveChallengeMiss(state, at, id));
  assert.ok(totalXp(state) < before);
  assert.equal(state.challenges.difficultyStep, 1);
  assert.ok(state.challenges.processedInbox.includes(id));
});

test("confirming a challenge resets difficulty step", () => {
  const state = createInitialState(OPEN_EVENING);
  state.challenges.difficultyStep = 2;
  openChallenge(state, OPEN_EVENING, "confirm");
  confirmChallenge(state, OPEN_EVENING);
  assert.equal(state.challenges.difficultyStep, 0);
  assert.equal(state.challenges.current, null);
});

test("harder pick after a miss uses difficulty step", () => {
  const a = pickChallenge("seed-a", 0);
  const b = pickChallenge("seed-a", 2);
  assert.ok(b.reps >= a.reps);
  assert.ok(b.difficulty > a.difficulty);
});

test("inbox miss is idempotent by challenge id", () => {
  const state = stateWithXp(OPEN_EVENING);
  openChallenge(state, OPEN_EVENING, "inbox");
  const id = state.challenges.current.id;
  state.challengeInbox = [{ type: "miss", challengeId: id }, { type: "miss", challengeId: id }];
  const xp0 = totalXp(state);
  applyChallengeInbox(state, OPEN_EVENING);
  const xp1 = totalXp(state);
  applyChallengeInbox(state, OPEN_EVENING);
  assert.equal(totalXp(state), xp1);
  assert.ok(xp0 > xp1);
  assert.equal(state.challengeInbox.length, 0);
});

test("quiet hours cancel an open challenge without punishment", () => {
  const state = createInitialState(OPEN_EVENING);
  openChallenge(state, OPEN_EVENING, "quiet");
  const xp = totalXp(state);
  const { events } = processChallenges(state, SCHOOL_FRIDAY);
  assert.ok(events.some((e) => e.type === "quiet-cancel"));
  assert.equal(state.challenges.current, null);
  assert.equal(totalXp(state), xp);
});

test("full-day unlock ignores events", () => {
  const state = createInitialState(OPEN_EVENING);
  const today = "2026-11-13";
  const day = state.days[today];
  for (const slot of SLOTS) {
    for (const task of day.slots[slot]) {
      task.done = true;
    }
  }
  day.slots.morning.push({
    id: "evt",
    title: "Party",
    why: "",
    time: "",
    isEvent: true,
    done: false,
    doneAt: null,
  });
  assert.equal(isFullDayQuests(state, today), true);
});

test("settings persist through patch, migrate, and import", () => {
  let state = createInitialState(OPEN_EVENING);
  state = patchSettings(state, {
    quietSchool: { on: false, start: "07:00", end: "15:00" },
    quietNight: { on: true, start: "21:30", end: "07:00" },
    blockedPackages: ["com.example.app"],
  });
  assert.equal(state.settings.quietSchool.on, false);
  assert.deepEqual(state.settings.blockedPackages, ["com.example.app"]);
  state = migrateStateV2(state, OPEN_EVENING);
  assert.equal(state.settings.quietSchool.start, "07:00");
  const raw = structuredClone(state);
  const imported = sanitizeImport(raw, null);
  assert.equal(imported.settings.quietSchool.end, "15:00");
  assert.equal(imported.challenges.difficultyStep, 0);
});

test("prepare folds challenge inbox processing", () => {
  const state = stateWithXp(OPEN_EVENING);
  openChallenge(state, OPEN_EVENING, "prep");
  const id = state.challenges.current.id;
  state.challengeInbox = [{ type: "miss", challengeId: id }];
  state.challenges.current.deadlineAt = new Date(OPEN_EVENING.getTime() - 1000).toISOString();
  const xpBefore = totalXp(state);
  const prepared = prepare(state, OPEN_EVENING);
  assert.ok(totalXp(prepared.state) < xpBefore);
});

test("roll interval stays within hourly band", () => {
  const state = createInitialState(OPEN_EVENING);
  state.challenges.nextRollAt = new Date(OPEN_EVENING.getTime() - 5000).toISOString();
  processChallenges(state, OPEN_EVENING);
  const next = new Date(state.challenges.nextRollAt).getTime() - OPEN_EVENING.getTime();
  assert.ok(next >= ROLL_MIN_MS - 5000);
});

test("processChallenges seeds nextRollAt in place when missing", () => {
  const state = createInitialState(OPEN_EVENING);
  state.challenges.nextRollAt = null;
  const { events } = processChallenges(state, OPEN_EVENING);
  assert.equal(events.length, 0);
  assert.ok(state.challenges.nextRollAt);
});