import assert from "node:assert/strict";
import test from "node:test";
import { compactBarVisible, intersectionRatio } from "../src/ui/todayCompact.js";

test("intersectionRatio and compactBarVisible follow the 0.15 compact threshold", () => {
  const root = { top: 52, bottom: 800, height: 748 };
  const full = { top: 60, bottom: 280, height: 220 };
  assert.equal(intersectionRatio(root, full), 1);
  assert.equal(compactBarVisible(1), false);

  const peeking = { top: 40, bottom: 70, height: 220 };
  assert.ok(intersectionRatio(root, peeking) < 0.15);
  assert.equal(compactBarVisible(intersectionRatio(root, peeking)), true);

  const gone = { top: 20, bottom: 40, height: 220 };
  assert.equal(intersectionRatio(root, gone), 0);
  assert.equal(compactBarVisible(0), true);
});