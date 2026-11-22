import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isNativeApp,
  nativeNotificationId,
  nativeReminderPayloads,
  splitNativeReminders,
} from "../src/notify.js";

test("native reminder ids stay inside a Java int and do not change", () => {
  const tag = "quest:2026-11-16:07:20:Make your bed";
  const id = nativeNotificationId(tag);
  assert.equal(id, nativeNotificationId(tag));
  assert.ok(id >= 1 && id <= 2147483646);
  assert.notEqual(id, nativeNotificationId("quest:2026-11-16:18:30:Train"));
});

test("native schedule keeps future quests and replays an unflagged one that is already due", () => {
  const now = Date.parse("2026-11-16T08:00:00.000Z");
  const records = [
    { tag: "future", title: "Later", body: "Afternoon", when: now + 60_000, expires: now + 86_400_000, date: "2026-11-16", taskId: "a" },
    { tag: "due", title: "Now", body: "Morning", when: now - 60_000, expires: now + 86_400_000, date: "2026-11-16", taskId: "b" },
    { tag: "seen", title: "Seen", body: "Morning", when: now - 120_000, expires: now + 86_400_000, date: "2026-11-16", taskId: "c" },
    { tag: "old", title: "Old", body: "Yesterday", when: now - 86_400_000, expires: now - 1000, date: "2026-11-15", taskId: "d" },
  ];
  const split = splitNativeReminders(records, now, ["seen"]);
  assert.deepEqual(split.future.map((row) => row.tag), ["future"]);
  assert.deepEqual(split.due.map((row) => row.tag), ["due"]);
  const payloads = nativeReminderPayloads([...split.future, ...split.due], now);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].schedule.allowWhileIdle, true);
  assert.ok(payloads[0].schedule.at.getTime() > now);
  assert.ok(payloads[1].schedule.at.getTime() >= now);
  assert.equal(payloads[1].extra.tag, "due");
});

test("syncNativeReminders requests permission for prompt and prompt-with-rationale", () => {
  const src = fs.readFileSync(new URL("../src/notify.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function syncNativeReminders"));
  assert.match(fn, /checkPermissions/);
  assert.match(fn, /requestPermissions/);
  assert.match(fn, /prompt-with-rationale/);
  assert.ok(fn.indexOf("requestPermissions") > fn.indexOf("checkPermissions"));
});

test("service worker ready is not awaited on the native reminder path", () => {
  assert.equal(isNativeApp(), false);
  const src = fs.readFileSync(new URL("../src/notify.js", import.meta.url), "utf8");
  for (const name of ["syncReminderSchedule", "registerPeriodic", "periodicStatus"]) {
    const start = src.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, name);
    const next = src.indexOf("\nexport async function ", start + 10);
    const body = src.slice(start, next === -1 ? src.length : next);
    const guard = body.indexOf("isNativeApp()");
    const ready = body.indexOf("serviceWorker.ready");
    assert.ok(guard >= 0, `${name} should leave the web path on native`);
    if (ready >= 0) assert.ok(guard < ready, `${name} must not wait for the service worker on native`);
  }
});
