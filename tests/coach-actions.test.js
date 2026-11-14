import assert from "node:assert/strict";
import test from "node:test";
import { applyCoachActions, isDestructiveAction, planCoachTurn } from "../src/coachActions.js";
import { createInitialState } from "../src/domain.js";
import { buildCoachContext } from "../src/coachContext.js";
import { redactChatText } from "../src/chatLog.js";
import { redactSensitive, parseCoachPayload } from "../src/gemini.js";

const NOW = new Date("2026-11-13T12:00:00Z");

test("unknown coach actions fail closed", () => {
  const state = createInitialState(NOW);
  const plan = planCoachTurn(state, [{ name: "reset" }]);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /can't run/);
});

test("addQuest lands in the right slot", () => {
  const state = createInitialState(NOW);
  const today = "2026-11-13";
  const result = applyCoachActions(
    state,
    [{ name: "addQuest", date: today, slot: "morning", title: "Drink water", why: "Hydration", time: "07:10" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(result.ok, true);
  const task = result.state.days[today].slots.morning.find((t) => t.title === "Drink water");
  assert.ok(task);
  assert.equal(task.time, "07:10");
});

test("deleteQuest waits for confirm", () => {
  const state = createInitialState(NOW);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  const plan = planCoachTurn(state, [{ name: "deleteQuest", date: today, slot: "morning", taskId: task.id }]);
  assert.equal(plan.needsConfirm, true);
  const blocked = applyCoachActions(state, plan.actions, NOW);
  assert.equal(blocked.ok, false);
});

test("mixed batch with delete does not apply before confirm", () => {
  const state = createInitialState(NOW);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  const before = state.days[today].slots.morning.length;
  const plan = planCoachTurn(state, [
    { name: "addQuest", date: today, slot: "evening", title: "Read", time: "21:00" },
    { name: "deleteQuest", date: today, slot: "morning", taskId: task.id },
  ]);
  assert.equal(plan.needsConfirm, true);
  const snap = applyCoachActions(state, plan.actions, NOW);
  assert.equal(snap.ok, false);
  assert.equal(state.days[today].slots.morning.length, before);
});

test("patchSettings ignores secret fields", () => {
  const state = createInitialState(NOW);
  const next = applyCoachActions(
    state,
    [{ name: "patchSettings", geminiApiKey: "bogus-value", sound: false }],
    NOW,
    { confirmed: true },
  );
  assert.equal(next.ok, true);
  assert.equal(next.state.settings.geminiApiKey, "");
  assert.equal(next.state.settings.sound, false);
});

test("setQuestDone pays XP once", () => {
  let state = createInitialState(NOW);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  const xp0 = state.xpEvents.length;
  state = applyCoachActions(
    state,
    [{ name: "setQuestDone", taskId: task.id, done: true }],
    NOW,
    { confirmed: true },
  ).state;
  assert.equal(state.xpEvents.length, xp0 + 1);
  state = applyCoachActions(
    state,
    [{ name: "setQuestDone", taskId: task.id, done: true }],
    NOW,
    { confirmed: true },
  ).state;
  assert.equal(state.xpEvents.length, xp0 + 1);
});

test("coach context never includes the raw key", () => {
  const state = createInitialState(NOW);
  state.settings.geminiApiKey = "secret-key-ending-abcd";
  const json = JSON.stringify(buildCoachContext(state, NOW));
  assert.ok(!json.includes("secret-key"));
  assert.equal(buildCoachContext(state, NOW).settings.hasGeminiKey, true);
});

test("chat redaction strips key-like tokens", () => {
  const text = redactChatText("saved AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  assert.ok(!text.includes("AIza"));
  assert.ok(text.includes("[redacted]"));
});

test("parseCoachPayload returns reply and actions", () => {
  const payload = parseCoachPayload({ reply: "Added it.", actions: [{ name: "fillOpenDays" }] });
  assert.equal(payload.reply, "Added it.");
  assert.equal(payload.actions.length, 1);
});

test("copyDay replace is destructive", () => {
  const state = createInitialState(NOW);
  assert.equal(
    isDestructiveAction(
      { name: "copyDay", mode: "replace", sourceDate: "2026-11-13", targetDates: ["2026-11-14"] },
      state,
    ),
    true,
  );
});