import assert from "node:assert/strict";
import test from "node:test";
import { artUrl, catalogArtId } from "../src/art.js";

test("catalog art ids map shop ids to webp basenames", () => {
  assert.equal(catalogArtId("theme-frost"), "theme-frost");
  assert.equal(catalogArtId("badge-full"), "badge-fullday");
  assert.match(artUrl("currency"), /\/art\/currency\.webp$/);
});