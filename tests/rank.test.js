import assert from "node:assert/strict";
import test from "node:test";
import { LEVEL_START, levelFor, levelStart } from "../src/economy.js";
import { RANK_TIERS, nextRankLevel, rankBadgeHtml, rankEmblemSvg, rankForLevel, rankForXp, rankMeta, roman } from "../src/rank.js";

test("rank tiers follow level bands from Bronze to Grandmaster", () => {
  assert.equal(rankForLevel(1), "bronze");
  assert.equal(rankForLevel(3), "bronze");
  assert.equal(rankForLevel(4), "silver");
  assert.equal(rankForLevel(7), "gold");
  assert.equal(rankForLevel(10), "platinum");
  assert.equal(rankForLevel(15), "diamond");
  assert.equal(rankForLevel(20), "master");
  assert.equal(rankForLevel(29), "grandmaster");
  assert.equal(rankForXp(LEVEL_START[9]), "platinum");
  assert.equal(RANK_TIERS.length, 7);
  assert.equal(levelFor(0), 1);
});

test("ranks never run out: Legend I, II, III… every 5 levels after 30", () => {
  assert.equal(rankMeta(30).name, "Legend I");
  assert.equal(rankMeta(34).name, "Legend I");
  assert.equal(rankMeta(35).name, "Legend II");
  assert.equal(rankMeta(75).name, "Legend X");
  assert.equal(rankForLevel(500), "legend-95");
  assert.equal(roman(2026), "MMXXVI");
  for (let level = 1; level < 200; level += 1) {
    const meta = rankMeta(level);
    assert.ok(level >= meta.minLevel && level <= meta.maxLevel, `level ${level}`);
    assert.equal(meta.step, level - meta.minLevel + 1);
    assert.ok(nextRankLevel(level) > level);
    assert.notEqual(rankForLevel(nextRankLevel(level)), rankForLevel(level));
  }
});

test("rank emblem is an SVG with tier colours, unique gradient ids and progress pips", () => {
  const a = rankEmblemSvg(10);
  const b = rankEmblemSvg(10);
  assert.match(a, /^<svg class="rank-emblem/);
  assert.match(a, /data-rank="platinum"/);
  const idA = a.match(/id="(rk\d+)f"/)[1];
  const idB = b.match(/id="(rk\d+)f"/)[1];
  assert.notEqual(idA, idB);
  assert.match(rankEmblemSvg(35), />II</);
  const badge = rankBadgeHtml(12);
  assert.equal((badge.match(/<i class="on">/g) || []).length, 3);
  assert.equal((badge.match(/<i /g) || []).length, 5);
  assert.ok(levelStart(40) > levelStart(39));
});
