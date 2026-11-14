import assert from "node:assert/strict";
import test from "node:test";
import { migrateStateV2 } from "../src/migrate.js";
import { FREEZE_REFUND_CRYSTALS } from "../src/penalty.js";

test("freeze inventory refunds crystals and is removed", () => {
  const state = {
    version: 1,
    settings: { sound: false, haptics: true, theme: "ember" },
    crystals: 4,
    freezes: 2,
    freezeLog: [{ date: "2026-11-10", at: "2026-11-11T08:00:00.000Z" }],
    grants: {},
    ownedThemes: ["ember"],
    crystalLog: [],
  };
  const next = migrateStateV2(state);
  assert.equal(next.freezes, undefined);
  assert.equal(next.freezeLog, undefined);
  assert.equal(next.crystals, 4 + 2 * FREEZE_REFUND_CRYSTALS);
  assert.ok(next.crystalLog.some((e) => e.reason === "freeze-refund"));
  assert.equal(next.grants.freezeMigrated, true);
  const again = migrateStateV2(next);
  assert.equal(again.crystals, next.crystals);
});