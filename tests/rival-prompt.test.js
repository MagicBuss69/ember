import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { buildBoard, rivalPromptFacts, rivalWeekXp, rivalStreak } from "../src/rivals.js";

const NOW = new Date("2026-11-13T20:00:00Z");

test("rivalPromptFacts matches board week XP and streak", () => {
  const state = createInitialState(NOW);
  const board = buildBoard(state, NOW);
  const facts = rivalPromptFacts(state, "leo", NOW);
  const row = board.board.find((item) => item.id === "leo");
  assert.ok(facts);
  assert.equal(facts.weekXp, row.weekXp);
  assert.equal(facts.streak, row.streak);
  assert.equal(facts.weekXp, rivalWeekXp(state, "leo", "2026-11-13", NOW));
  assert.equal(facts.noActions, true);
  assert.ok(facts.voice);
});

test("rival facts stay stable for a fixed clock", () => {
  const state = createInitialState(NOW);
  const a = rivalPromptFacts(state, "maja", NOW);
  const b = rivalPromptFacts(structuredClone(state), "maja", NOW);
  assert.deepEqual(
    { weekXp: a.weekXp, streak: a.streak, todayRest: a.todayRest },
    { weekXp: b.weekXp, streak: b.streak, todayRest: b.todayRest },
  );
  assert.equal(rivalStreak(state, "maja", "2026-11-13", NOW), a.streak);
});