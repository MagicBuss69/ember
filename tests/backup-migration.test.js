import assert from "node:assert/strict";
import test from "node:test";
import {
  backupFileShareable,
  formatRestoreSummary,
  parseBackupText,
  sanitizeImport,
  summarizeBackup,
} from "../src/backup.js";
import { XP_TASK, XP_WORKOUT } from "../src/constants.js";
import { createInitialState, prepare } from "../src/domain.js";
import { levelFor } from "../src/economy.js";
import { streakCount, totalXp } from "../src/stats.js";

test("backupFileShareable follows navigator.canShare for files", () => {
  const file = new File(["{}"], "ember-backup.json", { type: "application/json" });
  assert.equal(backupFileShareable(file, {}), false);
  assert.equal(
    backupFileShareable(file, { share: () => {}, canShare: ({ files }) => files?.[0] === file }),
    true,
  );
  assert.equal(backupFileShareable(file, { share: () => {}, canShare: () => false }), false);
});

test("exports in commit a911006 format and imports cleanly into new code without losing any data", () => {
  const exportNow = new Date("2026-11-13T21:15:00Z");
  const importNow = new Date("2026-11-14T07:30:00Z");

  // Build an exact a911006-era state (before geminiKeyStatus / workerToken / pushOn / driveLinked existed).
  const morningSixteen = Array.from({ length: 16 }, (_, idx) => ({
    id: `fri-m-${idx + 1}`,
    title: `Morning quest ${idx + 1}`,
    why: `Reason ${idx + 1}`,
    time: idx === 0 ? "7:20" : idx === 1 ? "07:35:00" : "07:45",
    done: idx < 4,
    doneAt: idx < 4 ? "2026-11-13T07:40:00.000Z" : null,
  }));

  const makeSimpleTasks = (prefix, count, doneCount, doneIso) =>
    Array.from({ length: count }, (_, idx) => ({
      id: `${prefix}-${idx + 1}`,
      title: `${prefix} quest ${idx + 1}`,
      why: "",
      time: "16:00",
      done: idx < doneCount,
      doneAt: idx < doneCount ? doneIso : null,
    }));

  // Total across days: 16 + 4 + 6 (Fri=26) + 8 (Thu) + 8 (Sat) = 42 quests!
  const oldDays = {
    "2026-11-12": {
      slots: {
        morning: makeSimpleTasks("thu-m", 3, 2, "2026-11-12T07:30:00.000Z"),
        afternoon: makeSimpleTasks("thu-a", 3, 1, "2026-11-12T15:30:00.000Z"),
        evening: makeSimpleTasks("thu-e", 2, 0, null),
      },
    },
    "2026-11-13": {
      slots: {
        morning: morningSixteen,
        afternoon: makeSimpleTasks("fri-a", 4, 2, "2026-11-13T16:10:00.000Z"),
        evening: makeSimpleTasks("fri-e", 6, 1, "2026-11-13T20:00:00.000Z"),
      },
    },
    "2026-11-14": {
      slots: {
        morning: makeSimpleTasks("sat-m", 4, 1, "2026-11-14T07:00:00.000Z"),
        afternoon: makeSimpleTasks("sat-a", 2, 0, null),
        evening: makeSimpleTasks("sat-e", 2, 0, null),
      },
    },
  };

  const oldTemplate = {};
  for (let wd = 1; wd <= 7; wd += 1) {
    oldTemplate[String(wd)] = {
      morning: [{ id: `tpl-${wd}-m`, title: `Custom template ${wd}`, why: "Keep momentum", time: "07:15" }],
      afternoon: [],
      evening: [],
    };
  }

  const oldWorkouts = Array.from({ length: 12 }, (_, idx) => (
    idx % 3 === 0
      ? {
          id: `wo-${idx + 1}`,
          date: "2026-11-13",
          name: "Run",
          kind: "cardio",
          sets: [],
          durationMin: 25 + idx,
          distanceKm: 5.2,
          notes: `Run #${idx + 1}`,
          createdAt: "2026-11-13T17:00:00.000Z",
        }
      : {
          id: `wo-${idx + 1}`,
          date: "2026-11-12",
          name: "Bench press",
          kind: "strength",
          sets: [
            { reps: 8, weightKg: 45 },
            { reps: 8, weightKg: 47.5 },
          ],
          durationMin: null,
          distanceKm: null,
          notes: `Lift #${idx + 1}`,
          createdAt: "2026-11-12T17:00:00.000Z",
        }
  ));

  // Build xpEvents for 10 of the 11 done tasks and 11 of the 12 workouts, plus one legacy ref-less bonus event,
  // to verify both faithful event preservation AND reconciliation of any missing done-quest/workout XP.
  const doneTaskIds = [
    "thu-m-1", "thu-m-2", "thu-a-1",
    "fri-m-1", "fri-m-2", "fri-m-3", "fri-m-4",
    "fri-a-1", "fri-a-2", "fri-e-1",
    "sat-m-1",
  ];
  const oldXpEvents = [
    ...doneTaskIds.slice(0, 10).map((id) => ({
      id: `ev-${id}`,
      at: "2026-11-13T18:00:00.000Z",
      date: id.startsWith("thu") ? "2026-11-12" : id.startsWith("sat") ? "2026-11-14" : "2026-11-13",
      amount: XP_TASK,
      source: "task",
      ref: id,
    })),
    ...oldWorkouts.slice(0, 11).map((wo) => ({
      id: `ev-${wo.id}`,
      at: wo.createdAt,
      date: wo.date,
      amount: XP_WORKOUT,
      source: "workout",
      ref: wo.id,
    })),
    // Legacy event missing `ref`
    {
      id: "legacy-no-ref",
      at: "2026-11-11T12:00:00.000Z",
      date: "2026-11-11",
      amount: 25,
      source: "task",
    },
  ];

  // Deliberately unsorted rivalDays keys
  const oldRivalDays = {
    "2026-11-13": { level: 3, byId: { leo: { xp: 52, rest: false, workout: true, quest: "Push session", minute: 600 } } },
    "2026-11-10": { level: 2, byId: { leo: { xp: 40, rest: false, workout: false, quest: "Core work", minute: 540 } } },
    "2026-11-12": { level: 3, byId: { leo: { xp: 0, rest: true, workout: false, quest: null, minute: 500 } } },
  };

  // Exact JSON shape produced by a911006 `JSON.stringify(state, null, 2)` (plus UTF-8 BOM from mobile file managers)
  const a911006BackupObject = {
    version: 1,
    startedOn: "2026-11-10",
    settings: {
      geminiApiKey: "AIzaSyTestOldBackupKey_9988",
      goals: "Build my own game engine and bench 60 kg.",
      theme: "pine",
      sound: false,
      haptics: true,
      dismissedHint: true,
    },
    crystals: 24,
    crystalLog: [
      { at: exportNow.toISOString(), delta: 6, reason: "level" },
      { at: exportNow.toISOString(), delta: 1, reason: "streak" },
    ],
    freezes: 2,
    freezeLog: [{ date: "2026-11-11", at: "2026-11-12T06:00:00.000Z" }],
    ownedThemes: ["ember", "pine"],
    grants: {
      "streakday:2026-11-12": true,
      "streakday:2026-11-13": true,
      "streakday:2026-11-14": true,
      "full:2026-11-14": false, // falsy grant must NOT turn truthy and claw back 3 crystals!
      "level:2": true,
      "level:3": true,
      "level:4": true,
      "level:5": true,
    },
    template: oldTemplate,
    days: oldDays,
    workouts: oldWorkouts,
    xpEvents: oldXpEvents,
    longest: 5,
    rivalDays: oldRivalDays,
  };

  const exportedText = `\uFEFF${JSON.stringify(a911006BackupObject, null, 2)}`;

  // Simulate new c5154ec+ device state that already has a Worker token configured
  const currentOnPhone = createInitialState(importNow);
  currentOnPhone.settings.workerToken = "mag-worker-secret";
  currentOnPhone.settings.pushOn = true;

  const parsed = parseBackupText(exportedText);
  const sanitized = sanitizeImport(parsed, currentOnPhone);
  const prepared = prepare(sanitized, importNow).state;

  // All 16 morning quests on Friday survived (no 12-item truncation), and times normalized
  assert.equal(prepared.days["2026-11-13"].slots.morning.length, 16);
  assert.equal(prepared.days["2026-11-13"].slots.morning[0].time, "07:20");
  assert.equal(prepared.days["2026-11-13"].slots.morning[1].time, "07:35");

  // Custom template survived for all 7 weekdays
  for (let wd = 1; wd <= 7; wd += 1) {
    assert.equal(prepared.template[String(wd)].morning[0].title, `Custom template ${wd}`);
  }

  // All 12 workouts survived with sets and cardio fields intact
  assert.equal(prepared.workouts.length, 12);
  assert.equal(prepared.workouts[0].distanceKm, 5.2);
  assert.equal(prepared.workouts[1].sets.length, 2);

  // XP = 11 done tasks * 25 + 12 workouts * 40 + 25 legacy = 275 + 480 + 25 = 780 XP -> Level 6
  const expectedXp = 11 * XP_TASK + 12 * XP_WORKOUT + 25;
  assert.equal(totalXp(prepared), expectedXp);
  const expectedLevel = levelFor(expectedXp);
  assert.equal(expectedLevel, 6);

  // Crystals: backup balance plus freeze refunds (2 × 16), level grants aren't double-paid
  assert.equal(prepared.crystals, 24 + 32);
  assert.equal(prepared.freezes, undefined);
  assert.equal(prepared.longest, 5);
  assert.equal(streakCount(prepared, "2026-11-14"), 3);

  // Settings + owned theme + rivalDays + device-local workerToken all preserved
  assert.equal(prepared.settings.geminiApiKey, "AIzaSyTestOldBackupKey_9988");
  assert.equal(prepared.settings.goals, "Build my own game engine and bench 60 kg.");
  assert.equal(prepared.settings.theme, "pine");
  assert.equal(prepared.settings.sound, false);
  assert.equal(prepared.settings.dismissedHint, true);
  assert.equal(prepared.settings.workerToken, "mag-worker-secret");
  assert.equal(prepared.settings.pushOn, true);
  assert.equal(prepared.rivalDays["2026-11-13"].byId.leo.xp, 52);

  // Summary counts the restored days' quests (42 across the 3 imported days + 4 auto-filled open weekdays of this week = 46)
  const beforePrepareSummary = summarizeBackup(sanitized);
  assert.equal(beforePrepareSummary.quests, 42);
  assert.equal(beforePrepareSummary.workouts, 12);
  assert.equal(beforePrepareSummary.level, 6);
  assert.equal(formatRestoreSummary(sanitized), "Restored 42 quests, 12 workouts, level 6");
});
