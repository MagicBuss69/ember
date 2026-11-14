import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { buyItem, isOwned, SHOP_CATALOG } from "../src/shop.js";

test("shop purchase spends crystals and equips theme", () => {
  let state = createInitialState(new Date());
  state.crystals = 20;
  const pine = SHOP_CATALOG.find((item) => item.id === "theme-pine");
  assert.ok(pine);
  const bought = buyItem(state, pine.id, new Date());
  assert.equal(bought.ok, true);
  assert.ok(isOwned(bought.state, pine));
  assert.equal(bought.state.settings.theme, "pine");
  assert.equal(bought.state.crystals, 10);
});

test("cannot buy twice", () => {
  let state = createInitialState(new Date());
  state.crystals = 30;
  state.ownedTitles = ["hunter"];
  const item = SHOP_CATALOG.find((i) => i.id === "title-hunter");
  const again = buyItem(state, item.id, new Date());
  assert.equal(again.ok, false);
});