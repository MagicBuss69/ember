import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeImport } from "../src/backup.js";
import { createInitialState } from "../src/domain.js";
import { extractJson, normalizePlan } from "../src/gemini.js";

test("parses fenced Gemini JSON into a capped week", () => {
  const text = "```json\n" + JSON.stringify({
    days: [
      {
        weekday: 1,
        morning: [
          { title: "Get outside", why: "Light.", time: "07:15" },
          { title: "Extra", why: "", time: "99:99" },
        ],
        afternoon: [{ title: "Code block", why: "One hour.", time: "16:10" }],
        evening: [
          { title: "Walk", why: "", time: "18:40" },
          { title: "Read", why: "", time: "21:00" },
          { title: "Too many", why: "", time: "21:20" },
        ],
      },
    ],
  }) + "\n```";
  const plan = normalizePlan(extractJson(text));
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].morning[1].time, "");
  const count = ["morning", "afternoon", "evening"].reduce((n, slot) => n + plan.days[0][slot].length, 0);
  assert.equal(count, 5);
});

test("backup round-trip keeps quests and drops a bad theme", () => {
  const state = createInitialState(new Date("2026-11-13T12:00:00Z"));
  state.settings.theme = "nope";
  state.xpEvents.push({
    id: "e1",
    at: "2026-11-13T07:00:00.000Z",
    date: "2026-11-13",
    amount: 50,
    source: "task",
    ref: "missing",
  });
  const imported = sanitizeImport(JSON.parse(JSON.stringify({ ...state, version: 1 })));
  assert.equal(imported.settings.theme, "ember");
  assert.equal(imported.days["2026-11-13"].slots.morning.length, 2);
  assert.ok(imported.grants["level:2"]);
  assert.throws(() => sanitizeImport({ version: 2 }), /different Ember version/);
  assert.throws(() => sanitizeImport(null), /isn't an Ember backup/);
});
