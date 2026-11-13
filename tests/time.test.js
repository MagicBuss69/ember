import assert from "node:assert/strict";
import test from "node:test";
import { addDays, dateKey, stockholmParts, weekdayIso, weekdayLong, weekStart, zonedTimeToUtc } from "../src/time.js";

test("Stockholm date key and Monday week", () => {
  const friday = new Date("2026-11-13T12:00:00Z");
  assert.equal(dateKey(friday), "2026-11-13");
  assert.equal(weekdayIso("2026-11-13"), 5);
  assert.equal(weekdayLong("2026-11-13"), "Friday");
  assert.equal(weekStart("2026-11-13"), "2026-11-09");
  assert.equal(addDays("2026-11-13", -7), "2026-11-06");
});

test("civil time converts across CET and CEST", () => {
  const winter = zonedTimeToUtc("2026-01-15", "07:30");
  assert.equal(new Date(winter).toISOString(), "2026-01-15T06:30:00.000Z");
  const summer = zonedTimeToUtc("2026-07-15", "07:30");
  assert.equal(new Date(summer).toISOString(), "2026-07-15T05:30:00.000Z");
  const november = zonedTimeToUtc("2026-11-13", "07:30");
  assert.equal(new Date(november).toISOString(), "2026-11-13T06:30:00.000Z");
  const parts = stockholmParts(new Date(november));
  assert.equal(parts.hour, 7);
  assert.equal(parts.minute, 30);
  assert.equal(parts.key, "2026-11-13");
});

test("spring-forward morning still returns an instant", () => {
  const ms = zonedTimeToUtc("2026-03-29", "07:30");
  const parts = stockholmParts(new Date(ms));
  assert.equal(parts.key, "2026-03-29");
  assert.equal(parts.hour, 7);
  assert.equal(parts.minute, 30);
});
