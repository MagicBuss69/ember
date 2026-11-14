import assert from "node:assert/strict";
import test from "node:test";
import { XP_TASK } from "../src/constants.js";
import {
  addTask,
  copyDayToDates,
  copyTemplateWeekday,
  createInitialState,
  deleteTask,
  deleteTemplateTask,
  occupiedCopyTargets,
  setTaskDone,
} from "../src/domain.js";
import {
  DRIVE_DEBOUNCE_MS,
  DRIVE_OPEN_MAX_AGE_MS,
  DRIVE_THROTTLE_MS,
  computeAutoBackupDelay,
  createAutoBackupController,
  formatLastBackupTime,
  isAutoBackupEnabled,
  shouldAutoBackupOnOpen,
} from "../src/driveSchedule.js";
import { totalXp } from "../src/stats.js";

const NOW = new Date("2026-11-13T18:00:00Z");
const CLIENT_ID = "893414975311-test.apps.googleusercontent.com";

test("copyDayToDates replaces quests with fresh unchecked IDs and cleans up overwritten XP", () => {
  let state = createInitialState(NOW);
  const fri = "2026-11-13";
  const mon = "2026-11-09";
  const tue = "2026-11-10";

  // Customize Friday order & check one quest off on Friday AND one on Monday
  state = addTask(state, fri, "afternoon", { title: "Ship feature", why: "Momentum", time: "17:15" }, NOW);
  const friDoneId = state.days[fri].slots.morning[0].id;
  state = setTaskDone(state, fri, "morning", friDoneId, true, NOW);

  const monDoneId = state.days[mon].slots.morning[0].id;
  state = setTaskDone(state, mon, "morning", monDoneId, true, NOW);
  assert.equal(totalXp(state), XP_TASK * 2);

  // Clear Tuesday so we can check occupiedCopyTargets
  for (const slot of ["morning", "afternoon", "evening"]) {
    for (const task of [...state.days[tue].slots[slot]]) {
      state = deleteTask(state, tue, slot, task.id, NOW);
    }
  }
  assert.deepEqual(occupiedCopyTargets(state, "week", [mon, tue]), [mon]);

  const { state: replaced, copied } = copyDayToDates(state, fri, [mon, tue, fri], "replace", NOW);
  assert.equal(copied, 2);

  // Overwriting Monday dropped Monday's completed quest XP while keeping Friday's XP
  assert.equal(totalXp(replaced), XP_TASK);

  const srcIds = new Set(
    ["morning", "afternoon", "evening"].flatMap((slot) => replaced.days[fri].slots[slot].map((t) => t.id)),
  );

  for (const target of [mon, tue]) {
    for (const slot of ["morning", "afternoon", "evening"]) {
      const srcList = replaced.days[fri].slots[slot];
      const dstList = replaced.days[target].slots[slot];
      assert.deepEqual(
        dstList.map((t) => ({ title: t.title, why: t.why, time: t.time })),
        srcList.map((t) => ({ title: t.title, why: t.why, time: t.time })),
      );
      for (const task of dstList) {
        assert.equal(task.done, false);
        assert.equal(task.doneAt, null);
        assert.equal(srcIds.has(task.id), false);
      }
    }
  }
  // IDs on Monday and Tuesday are also distinct from each other
  assert.notEqual(replaced.days[mon].slots.morning[0].id, replaced.days[tue].slots.morning[0].id);
});

test("copyDayToDates in append mode keeps existing quests and XP while appending in slot order", () => {
  let state = createInitialState(NOW);
  const fri = "2026-11-13";
  const sat = "2026-11-14";

  const satFirst = state.days[sat].slots.morning[0];
  state = setTaskDone(state, sat, "morning", satFirst.id, true, NOW);
  const beforeMorningCount = state.days[sat].slots.morning.length;
  const friMorningTitles = state.days[fri].slots.morning.map((t) => t.title);

  const { state: appended, copied } = copyDayToDates(state, fri, [sat], "append", NOW);
  assert.equal(copied, 1);
  assert.equal(totalXp(appended), XP_TASK);
  assert.equal(appended.days[sat].slots.morning[0].id, satFirst.id);
  assert.equal(appended.days[sat].slots.morning[0].done, true);
  assert.equal(appended.days[sat].slots.morning.length, beforeMorningCount + friMorningTitles.length);
  assert.deepEqual(
    appended.days[sat].slots.morning.slice(beforeMorningCount).map((t) => t.title),
    friMorningTitles,
  );
  assert.ok(appended.days[sat].slots.morning.slice(beforeMorningCount).every((t) => !t.done));
});

test("copyTemplateWeekday copies across template weekdays in both replace and append modes", () => {
  let state = createInitialState(NOW);
  // Empty Sunday ("7") template first
  for (const slot of ["morning", "afternoon", "evening"]) {
    for (const item of [...state.template["7"][slot]]) {
      state = deleteTemplateTask(state, "7", slot, item.id);
    }
  }
  assert.deepEqual(occupiedCopyTargets(state, "template", ["6", "7"]), ["6"]);

  const monMorning = state.template["1"].morning.map((t) => ({ title: t.title, time: t.time }));
  const satBefore = state.template["6"].morning.length;

  const rep = copyTemplateWeekday(state, "1", ["7"], "replace");
  assert.equal(rep.copied, 1);
  assert.deepEqual(
    rep.state.template["7"].morning.map((t) => ({ title: t.title, time: t.time })),
    monMorning,
  );
  assert.notEqual(rep.state.template["7"].morning[0].id, rep.state.template["1"].morning[0].id);

  const app = copyTemplateWeekday(rep.state, "1", ["6"], "append");
  assert.equal(app.copied, 1);
  assert.equal(app.state.template["6"].morning.length, satBefore + monMorning.length);
});

test("auto-backup pure functions enforce 2-minute debounce, 30-minute throttle, and >24h open check", () => {
  const t0 = Date.parse("2026-11-14T10:00:00.000Z");
  const baseSettings = {
    driveLinked: true,
    driveAutoBackup: true,
    driveLastBackupAt: "",
    driveLastBackupOn: "",
  };

  // Gating: off when unlinked, missing clientId, or driveAutoBackup === false
  assert.equal(isAutoBackupEnabled({ ...baseSettings, driveLinked: false }, CLIENT_ID), false);
  assert.equal(isAutoBackupEnabled(baseSettings, ""), false);
  assert.equal(isAutoBackupEnabled({ ...baseSettings, driveAutoBackup: false }, CLIENT_ID), false);
  // Default on even when driveAutoBackup is undefined (migrated state)
  assert.equal(isAutoBackupEnabled({ driveLinked: true }, CLIENT_ID), true);

  // App-open >24h check
  assert.equal(shouldAutoBackupOnOpen({ settings: baseSettings, clientId: CLIENT_ID, nowMs: t0 }), true);
  const recentSettings = {
    ...baseSettings,
    driveLastBackupAt: new Date(t0 - DRIVE_OPEN_MAX_AGE_MS + 60_000).toISOString(),
  };
  assert.equal(shouldAutoBackupOnOpen({ settings: recentSettings, clientId: CLIENT_ID, nowMs: t0 }), false);
  const staleSettings = {
    ...baseSettings,
    driveLastBackupAt: new Date(t0 - DRIVE_OPEN_MAX_AGE_MS - 60_000).toISOString(),
  };
  assert.equal(shouldAutoBackupOnOpen({ settings: staleSettings, clientId: CLIENT_ID, nowMs: t0 }), true);

  // Debounce: 2 minutes after latest change when no recent backup
  assert.equal(
    computeAutoBackupDelay({
      settings: staleSettings,
      clientId: CLIENT_ID,
      lastChangeMs: t0,
      nowMs: t0,
    }),
    DRIVE_DEBOUNCE_MS,
  );
  // 30s into debounce, a second edit resets the remaining wait back to a full 2 minutes
  assert.equal(
    computeAutoBackupDelay({
      settings: staleSettings,
      clientId: CLIENT_ID,
      lastChangeMs: t0 + 30_000,
      nowMs: t0 + 30_000,
    }),
    DRIVE_DEBOUNCE_MS,
  );

  // Throttle: if a backup succeeded 5 minutes ago and user edits now, wait 25 minutes (30 min total), not 2 min
  const fiveMinAgoSettings = {
    ...baseSettings,
    driveLastBackupAt: new Date(t0 - 5 * 60_000).toISOString(),
  };
  assert.equal(
    computeAutoBackupDelay({
      settings: fiveMinAgoSettings,
      clientId: CLIENT_ID,
      lastChangeMs: t0,
      nowMs: t0,
    }),
    DRIVE_THROTTLE_MS - 5 * 60_000,
  );

  // Human-readable Stockholm last backup label
  assert.equal(
    formatLastBackupTime(
      { driveLastBackupAt: "2026-11-14T07:05:00.000Z" },
      new Date("2026-11-14T09:00:00.000Z"),
    ),
    "today 08:05",
  );
  assert.equal(formatLastBackupTime({}), "never");
});

test("auto-backup controller coalesces rapid edits and throttles subsequent runs", async () => {
  let clock = Date.parse("2026-11-14T12:00:00.000Z");
  let nextId = 1;
  const timers = new Map();
  let runs = 0;
  const settings = {
    driveLinked: true,
    driveAutoBackup: true,
    driveLastBackupAt: new Date(clock - 2 * 60 * 60 * 1000).toISOString(),
  };

  const controller = createAutoBackupController({
    getContext: () => ({ settings, clientId: CLIENT_ID }),
    runBackup: async () => {
      runs += 1;
      settings.driveLastBackupAt = new Date(clock).toISOString();
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, fireAt: clock + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    now: () => clock,
  });

  // Three edits 20s apart coalesce into a single scheduled timer 2m after the third edit
  controller.noteChange();
  clock += 20_000;
  controller.noteChange();
  clock += 20_000;
  const delay = controller.noteChange();
  assert.equal(delay, DRIVE_DEBOUNCE_MS);
  assert.equal(timers.size, 1);

  // Advance 2m -> fires once
  const [firstTimer] = timers.values();
  timers.clear();
  clock = firstTimer.fireAt;
  await firstTimer.fn();
  assert.equal(runs, 1);

  // Edit again 1 minute later -> throttled to 29 minutes from now (30m since the backup at `clock - 60_000`)
  clock += 60_000;
  const throttledDelay = controller.noteChange();
  assert.equal(throttledDelay, DRIVE_THROTTLE_MS - 60_000);

  // Turning off Auto backup cancels the pending timer immediately
  settings.driveAutoBackup = false;
  controller.recheck();
  assert.equal(timers.size, 0);
});
