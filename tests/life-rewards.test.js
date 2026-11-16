import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { migrateStateV2 } from "../src/migrate.js";
import { addCustomReward, redeemCustomReward } from "../src/shop.js";
import {
  CUSTOM_RETURN_DAYS,
  LIFE_OFFER_POOL,
  OFFER_MAX,
  OFFER_MIN,
  OFFER_PERIOD_DAYS,
  daysUntilRestock,
  extendUnlockUntil,
  offerPeriod,
  parseUnlockMinutes,
  restockLifeOffers,
  returningLifeRewards,
  unlockMinutesLeft,
  visibleLifeRewards,
} from "../src/lifeRewards.js";

const DAY = 86_400_000;
const T0 = new Date("2026-11-16T12:00:00Z");

test("unlock minutes are parsed from reward names", () => {
  assert.equal(parseUnlockMinutes("30 min YouTube"), 30);
  assert.equal(parseUnlockMinutes("45min TikTok"), 45);
  assert.equal(parseUnlockMinutes("1h gaming"), 60);
  assert.equal(parseUnlockMinutes("1.5 hours phone"), 90);
  assert.equal(parseUnlockMinutes("Favorite snack"), 0);
  assert.equal(parseUnlockMinutes("999 min"), 240);
});

test("old saved rewards without new fields stay repeatable with no unlock", () => {
  const state = createInitialState(T0);
  state.customRewards = [{ id: "old1", title: "30 min gaming", price: 15, createdAt: T0.toISOString() }];
  state.crystals = 100;
  const migrated = migrateStateV2(state, T0);
  assert.equal(migrated.customRewards[0].oneTime, false);
  assert.equal(migrated.customRewards[0].unlockMinutes, 0);
  const r1 = redeemCustomReward(migrated, "old1", T0);
  assert.equal(r1.ok, true);
  assert.equal(r1.unlockMinutes, 0);
  const r2 = redeemCustomReward(r1.state, "old1", T0);
  assert.equal(r2.ok, true, "repeatable reward redeems again");
  assert.equal(r2.state.crystals, 70);
});

test("redeeming a reward with unlock minutes reports them and spends shards", () => {
  let state = createInitialState(T0);
  state.crystals = 50;
  state = addCustomReward(state, { title: "30 min YouTube", price: 20, unlockMinutes: 30 }, T0).state;
  const id = state.customRewards[0].id;
  const out = redeemCustomReward(state, id, T0);
  assert.equal(out.ok, true);
  assert.equal(out.unlockMinutes, 30);
  assert.equal(out.state.crystals, 30);
  assert.equal(out.state.crystalLog[0].delta, -20);
  const poor = redeemCustomReward({ ...out.state, crystals: 5 }, id, T0);
  assert.equal(poor.ok, false);
});

test("a running unlock is extended, not restarted", () => {
  const until = extendUnlockUntil("", 30, T0);
  assert.equal(Date.parse(until) - T0.getTime(), 30 * 60_000);
  const later = new Date(T0.getTime() + 10 * 60_000);
  const extended = extendUnlockUntil(until, 30, later);
  assert.equal(Date.parse(extended) - T0.getTime(), 60 * 60_000);
  const expired = extendUnlockUntil(until, 15, new Date(T0.getTime() + 2 * 3600_000));
  assert.equal(Date.parse(expired) - (T0.getTime() + 2 * 3600_000), 15 * 60_000);
  assert.equal(unlockMinutesLeft(extended, later), 50);
  assert.equal(unlockMinutesLeft(until, new Date(T0.getTime() + 3600_000)), 0);
});

test("a one-time custom reward hides after redeem and returns after the cooldown", () => {
  let state = createInitialState(T0);
  state.crystals = 100;
  state = addCustomReward(state, { title: "Pizza night", price: 30, oneTime: true }, T0).state;
  const id = state.customRewards[0].id;
  const out = redeemCustomReward(state, id, T0);
  assert.equal(out.ok, true);
  assert.equal(visibleLifeRewards(out.state, T0).custom.length, 0);
  assert.equal(returningLifeRewards(out.state, T0)[0].days, CUSTOM_RETURN_DAYS);
  const again = redeemCustomReward(out.state, id, T0);
  assert.equal(again.ok, false);
  const back = new Date(T0.getTime() + CUSTOM_RETURN_DAYS * DAY + 1000);
  assert.equal(visibleLifeRewards(out.state, back).custom.length, 1);
  assert.equal(redeemCustomReward(out.state, id, back).ok, true);
});

test("rotating offers restock deterministically and never run empty", () => {
  const base = createInitialState(T0);
  const a = restockLifeOffers(base, T0);
  const b = restockLifeOffers(base, T0);
  assert.deepEqual(a.lifeOffers, b.lifeOffers, "same date gives same offers");
  assert.equal(a.lifeOffers.offers.length, OFFER_MIN);
  assert.equal(restockLifeOffers(a, T0), a, "no change within the same period");
  // Redeem every offer: shelf empties until the next period, then refills.
  let state = { ...a, crystals: 999 };
  const redeemedIds = [];
  for (const offer of a.lifeOffers.offers) {
    const out = redeemCustomReward(state, offer.id, T0);
    assert.equal(out.ok, true);
    redeemedIds.push(offer.poolId);
    state = out.state;
  }
  assert.equal(visibleLifeRewards(state, T0).offers.length, 0);
  const next = new Date(T0.getTime() + daysUntilRestock(T0) * DAY);
  assert.equal(offerPeriod(next), offerPeriod(T0) + 1);
  const refilled = restockLifeOffers(state, next);
  assert.ok(refilled.lifeOffers.offers.length >= OFFER_MIN);
  for (const offer of refilled.lifeOffers.offers) {
    assert.ok(!redeemedIds.includes(offer.poolId), `${offer.poolId} should not repeat right away`);
  }
  // Untouched shelf grows by restocks but stays capped.
  let idle = a;
  for (let i = 1; i <= 6; i += 1) idle = restockLifeOffers(idle, new Date(T0.getTime() + i * OFFER_PERIOD_DAYS * DAY));
  assert.equal(idle.lifeOffers.offers.length, OFFER_MAX);
  assert.equal(new Set(idle.lifeOffers.offers.map((o) => o.poolId)).size, OFFER_MAX);
});

test("restock countdown and pool prices make sense", () => {
  const d = daysUntilRestock(T0);
  assert.ok(d >= 1 && d <= OFFER_PERIOD_DAYS);
  assert.ok(LIFE_OFFER_POOL.length >= 12);
  for (const item of LIFE_OFFER_POOL) {
    assert.ok(item.price >= 8 && item.price <= 60, item.poolId);
    assert.ok(item.unlockMinutes >= 0 && item.unlockMinutes <= 240, item.poolId);
  }
  assert.ok(LIFE_OFFER_POOL.some((item) => item.unlockMinutes > 0));
});

test("migration fills offers without bumping state.version", () => {
  const state = createInitialState(T0);
  const before = state.version;
  const migrated = migrateStateV2(state, T0);
  assert.equal(migrated.version, before);
  assert.equal(migrated.lifeOffers.offers.length, OFFER_MIN);
});

test("native relock: timer, tick, alarm, and reward grant are wired", () => {
  const dir = new URL("../android/app/src/main/java/se/ember/app/", import.meta.url);
  const read = (name) => readFileSync(new URL(name, dir), "utf8");
  const svc = read("EmberAccessibilityService.kt");
  const snap = read("BlockerSnapshot.kt");
  const plugin = read("EmberBlockerPlugin.kt");
  const sched = read("EmberAlarmScheduler.kt");
  assert.match(svc, /postDelayed\(expireRunnable/);
  assert.match(svc, /private fun onTick\(\)/);
  assert.match(svc, /TICK_MS = 15_000L/);
  assert.match(svc, /revokeExpired\(this, now\)/);
  assert.match(snap, /if \(now < unlockedUntilMs\) return false/);
  assert.match(snap, /fun grantRewardUnlock\(/);
  assert.match(plugin, /fun grantUnlock\(call: PluginCall\)/);
  assert.doesNotMatch(sched, /if \(snap\.blockMode != "pushups"\) return/);
  assert.ok(existsSync(new URL("EmberUnlockLoop.kt", dir)));
});
