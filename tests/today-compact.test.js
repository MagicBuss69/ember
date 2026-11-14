import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_BAR_FALLBACK_SCROLL,
  compactBarFromScroll,
} from "../src/ui/todayCompact.js";

test("compactBarFromScroll uses expanded bottom minus peek, with 140px fallback", () => {
  const bottom = 280;
  assert.equal(compactBarFromScroll(100, bottom), false);
  assert.equal(compactBarFromScroll(221, bottom), true);
  assert.equal(compactBarFromScroll(220, bottom), false);

  assert.equal(compactBarFromScroll(141, 0), true);
  assert.equal(compactBarFromScroll(140, 0), false);
  assert.equal(compactBarFromScroll(COMPACT_BAR_FALLBACK_SCROLL + 1, null), true);
});