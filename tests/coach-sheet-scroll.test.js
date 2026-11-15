import assert from "node:assert/strict";
import test from "node:test";
import { applyChatLogScrollEnd } from "../src/ui/coachSheet.js";

test("applyChatLogScrollEnd jumps chat log to newest message", () => {
  const log = { scrollTop: 40, scrollHeight: 280 };
  applyChatLogScrollEnd(log);
  assert.equal(log.scrollTop, 280);
});