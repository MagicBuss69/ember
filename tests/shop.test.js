import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { addCustomReward, buyItem, isOwned, removeCustomReward, SHOP_CATALOG } from "../src/shop.js";

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

test("custom life rewards can be removed from the shop list", () => {
  let state = createInitialState(new Date());
  const added = addCustomReward(state, { title: "30 min gaming", price: 15 }, new Date());
  assert.equal(added.ok, true);
  assert.equal(added.state.customRewards.length, 1);
  const id = added.state.customRewards[0].id;
  const removed = removeCustomReward(added.state, id);
  assert.equal(removed.ok, true);
  assert.equal(removed.state.customRewards.length, 0);
  const miss = removeCustomReward(removed.state, id);
  assert.equal(miss.ok, false);
});

test("cannot buy twice", () => {
  let state = createInitialState(new Date());
  state.crystals = 30;
  state.ownedTitles = ["hunter"];
  const item = SHOP_CATALOG.find((i) => i.id === "title-hunter");
  const again = buyItem(state, item.id, new Date());
  assert.equal(again.ok, false);
});