import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { addCustomReward, buyItem, equipCosmetic, isOwned, removeCustomReward, SHOP_CATALOG } from "../src/shop.js";

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

test("every shop item id has an equipped effect", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const sounds = readFileSync(new URL("../src/sounds.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/ui/screens.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  for (const item of SHOP_CATALOG) {
    const ok = item.kind === "theme" ? css.includes(`[data-theme="${item.themeId}"]`)
      : item.kind === "skin" ? css.includes(`.skin-${item.skinId}`)
      : item.kind === "title" ? ui.includes("equippedTitle")
      : item.kind === "badge" ? ui.includes("ownedBadges")
      : item.kind === "fx" ? app.includes(item.fxId === "shards" ? '=== "shards"' : "burstAt")
      : item.kind === "soundPack" ? sounds.includes(`=== "${item.soundPackId}"`)
      : false;
    assert.equal(ok, true, item.id);
  }
  let state = createInitialState(new Date());
  state.ownedSkins.push("ice");
  state.ownedTitles.push("hunter");
  state.ownedFx.push("nova");
  state.ownedSoundPacks.push("chime");
  state = equipCosmetic(state, { crystalSkin: "ice", equippedTitle: "hunter", checkFx: "nova", soundPack: "chime" });
  assert.equal(state.settings.crystalSkin, "ice");
  assert.equal(state.settings.equippedTitle, "hunter");
  assert.equal(state.settings.checkFx, "nova");
  assert.equal(state.settings.soundPack, "chime");
});

test("cannot buy twice", () => {
  let state = createInitialState(new Date());
  state.crystals = 30;
  state.ownedTitles = ["hunter"];
  const item = SHOP_CATALOG.find((i) => i.id === "title-hunter");
  const again = buyItem(state, item.id, new Date());
  assert.equal(again.ok, false);
});
test("store is about 2.5x bigger and every item has real art", async () => {
  const { ART_WEBP, catalogArtId } = await import("../src/art.js");
  const { itemArt, catalogName } = await import("../src/shop.js");
  const counts = {};
  for (const item of SHOP_CATALOG) counts[item.category] = (counts[item.category] || 0) + 1;
  assert.deepEqual(counts, { themes: 9, crystal: 8, titles: 8, badges: 5, fx: 5, sound: 5 });
  assert.equal(SHOP_CATALOG.length, 40);
  const ids = new Set(SHOP_CATALOG.map((item) => item.id));
  assert.equal(ids.size, SHOP_CATALOG.length);
  for (const item of SHOP_CATALOG) {
    assert.ok(ART_WEBP.includes(catalogArtId(itemArt(item).art)), item.id);
    assert.ok(item.price >= 6 && item.price <= 30, item.id);
  }
  assert.equal(catalogName("title", "ironwill"), "Iron Will");
  assert.equal(catalogName("badge", "rivalslayer"), "Rival slayer");
});

test("old owned items stay owned and equippable after the store grew", () => {
  let state = createInitialState(new Date());
  state.ownedThemes.push("pine");
  state.ownedSkins.push("void");
  state.ownedTitles.push("monarch");
  assert.ok(isOwned(state, SHOP_CATALOG.find((i) => i.id === "theme-pine")));
  assert.ok(isOwned(state, SHOP_CATALOG.find((i) => i.id === "skin-void")));
  assert.ok(isOwned(state, SHOP_CATALOG.find((i) => i.id === "title-monarch")));
  state.crystals = 100;
  const bought = buyItem(state, "fx-supernova", new Date());
  assert.equal(bought.ok, true);
  const eq = equipCosmetic(bought.state, { checkFx: "supernova" });
  assert.equal(eq.settings.checkFx, "supernova");
  assert.ok(eq.ownedSkins.includes("void"));
});
