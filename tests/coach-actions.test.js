import assert from "node:assert/strict";
import test from "node:test";
import { applyCoachActions, isDestructiveAction, planCoachTurn, previewCoachAction } from "../src/coachActions.js";
import { createInitialState } from "../src/domain.js";
import { buildCoachContext } from "../src/coachContext.js";
import { redactChatText } from "../src/chatLog.js";
import { redactSensitive, parseCoachPayload } from "../src/gemini.js";
import { weekdayIso } from "../src/time.js";

const NOW = new Date("2026-11-13T12:00:00Z");

test("non-object coach actions fail closed", () => {
  const state = createInitialState(NOW);
  const payloads = [
    { reply: "Done.", actions: [null] },
    { reply: "Done.", actions: ["addQuest"] },
  ];
  for (const raw of payloads) {
    const payload = parseCoachPayload(raw);
    const plan = planCoachTurn(state, payload.actions);
    assert.equal(plan.ok, false);
    assert.equal(plan.needsConfirm, undefined);
    assert.match(plan.error, /can't run/);
    const applied = applyCoachActions(state, payload.actions, NOW, { confirmed: true });
    assert.equal(applied.ok, false);
    assert.match(applied.error, /can't run/);
    assert.equal(applied.state, state);
  }
  assert.equal(isDestructiveAction(null, state), true);
  assert.equal(isDestructiveAction("addQuest", state), true);
});

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

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test("setQuestDone waits for confirm before XP changes", () => {
  let state = createInitialState(NOW);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  const xp0 = state.xpEvents.length;
  assert.equal(isDestructiveAction({ name: "setQuestDone", taskId: task.id, done: true }, state), true);
  const plan = planCoachTurn(state, [{ name: "setQuestDone", taskId: task.id, done: true }]);
  assert.equal(plan.needsConfirm, true);
  assert.equal(plan.ok, false);
  assert.equal(plan.previews[0], `Mark quest “${task.title}” done on ${today}`);
  assert.equal(
    previewCoachAction({ name: "setQuestDone", taskId: "missing-id", done: false }, state),
    "Mark quest “unknown” undone on ?",
  );
  const blocked = applyCoachActions(state, [{ name: "setQuestDone", taskId: task.id, done: true }], NOW);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state.xpEvents.length, xp0);
  assert.equal(state.days[today].slots.morning[0].done, false);

  state = applyCoachActions(
    state,
    [{ name: "setQuestDone", taskId: task.id, done: true }],
    NOW,
    { confirmed: true },
  ).state;
  assert.equal(state.xpEvents.length, xp0 + 1);

  const undo = applyCoachActions(state, [{ name: "setQuestDone", taskId: task.id, done: false }], NOW);
  assert.equal(undo.needsConfirm, true);
  assert.equal(undo.previews[0], `Mark quest “${task.title}” undone on ${today}`);
  assert.equal(undo.state.xpEvents.length, xp0 + 1);
  const undone = applyCoachActions(
    state,
    [{ name: "setQuestDone", taskId: task.id, done: false }],
    NOW,
    { confirmed: true },
  );
  assert.equal(undone.ok, true);
  assert.equal(undone.state.xpEvents.length, xp0);
  assert.equal(undone.state.days[today].slots.morning[0].done, false);
});

test("previews name the quest or event resolved by id", () => {
  let state = createInitialState(NOW);
  const today = "2026-11-13";
  const task = state.days[today].slots.morning[0];
  const wd = String(weekdayIso(today));
  const templateTask = state.template[wd].morning[0];
  const dayName = WEEKDAY_NAMES[Number(wd) - 1];

  assert.equal(
    previewCoachAction({ name: "deleteQuest", taskId: task.id }, state),
    `Delete quest “${task.title}” on ${today}`,
  );
  assert.equal(
    previewCoachAction({ name: "updateQuest", taskId: task.id, title: "Not the stored title" }, state),
    `Update quest “${task.title}” on ${today}`,
  );
  assert.equal(
    previewCoachAction({ name: "deleteQuest", taskId: "missing-id" }, state),
    "Delete quest “unknown” on ?",
  );
  assert.equal(
    previewCoachAction({ name: "updateQuest", taskId: "missing-id", title: "Later", date: "2026-11-14" }, state),
    "Update quest “Later” on 2026-11-14",
  );

  state = applyCoachActions(
    state,
    [{ name: "addEvent", date: today, slot: "evening", title: "Dentist", time: "15:00" }],
    NOW,
  ).state;
  const event = state.days[today].slots.evening.find((item) => item.title === "Dentist");
  assert.equal(
    previewCoachAction({ name: "updateEvent", taskId: event.id }, state),
    `Update event “Dentist” on ${today}`,
  );
  assert.equal(
    previewCoachAction({ name: "deleteEvent", taskId: event.id }, state),
    `Delete event “Dentist” on ${today}`,
  );
  assert.equal(
    previewCoachAction({ name: "updateTemplateQuest", taskId: templateTask.id }, state),
    `Update template quest “${templateTask.title}” on ${dayName}`,
  );
  assert.equal(
    previewCoachAction({ name: "deleteTemplateQuest", taskId: templateTask.id }, state),
    `Delete template quest “${templateTask.title}” on ${dayName}`,
  );
  assert.equal(
    previewCoachAction({ name: "deleteTemplateQuest", taskId: "missing-id" }, state),
    "Delete template quest “unknown” on ?",
  );
});

test("template edits by id work without a weekday and miss reports failure", () => {
  const state = createInitialState(NOW);
  const today = "2026-11-13";
  const wd = String(weekdayIso(today));
  const morning = state.template[wd].morning[0];
  const evening = state.template[wd].evening[0];

  const bySlot = applyCoachActions(
    state,
    [{ name: "updateTemplateQuest", taskId: morning.id, slot: "morning", title: "Renamed from slot" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(bySlot.ok, true);
  assert.equal(
    bySlot.state.template[wd].morning.find((item) => item.id === morning.id).title,
    "Renamed from slot",
  );

  const byId = applyCoachActions(
    state,
    [{ name: "updateTemplateQuest", taskId: evening.id, title: "Renamed from id" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(byId.ok, true);
  assert.equal(
    byId.state.template[wd].evening.find((item) => item.id === evening.id).title,
    "Renamed from id",
  );

  const removed = applyCoachActions(
    state,
    [{ name: "deleteTemplateQuest", taskId: morning.id, slot: "morning" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(removed.ok, true);
  assert.equal(removed.state.template[wd].morning.some((item) => item.id === morning.id), false);

  const before = state.template[wd].morning.length;
  const missing = applyCoachActions(
    state,
    [{ name: "updateTemplateQuest", taskId: "missing-id", title: "Nope" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /wasn't found/);
  assert.equal(missing.state.template[wd].morning.length, before);
  assert.equal(missing.state.template[wd].morning[0].title, morning.title);

  const missingDelete = applyCoachActions(
    state,
    [{ name: "deleteTemplateQuest", taskId: "missing-id", slot: "morning" }],
    NOW,
    { confirmed: true },
  );
  assert.equal(missingDelete.ok, false);
  assert.match(missingDelete.error, /wasn't found/);
  assert.equal(missingDelete.state.template[wd].morning.length, before);
});

test("a seventh coach action is rejected instead of dropped", () => {
  const state = createInitialState(NOW);
  const today = "2026-11-13";
  const actions = Array.from({ length: 7 }, (_, index) => ({
    name: "addQuest",
    date: today,
    slot: "evening",
    title: `Extra ${index}`,
  }));
  const plan = planCoachTurn(state, actions);
  assert.equal(plan.ok, false);
  assert.equal(plan.needsConfirm, undefined);
  assert.match(plan.error, /Too many actions/);
  const applied = applyCoachActions(state, actions, NOW, { confirmed: true });
  assert.equal(applied.ok, false);
  assert.equal(applied.state.days[today].slots.evening.some((item) => String(item.title).startsWith("Extra")), false);

  const six = applyCoachActions(state, actions.slice(0, 6), NOW, { confirmed: true });
  assert.equal(six.ok, true);
  assert.equal(six.state.days[today].slots.evening.filter((item) => String(item.title).startsWith("Extra")).length, 6);
});