import { SLOTS } from "./constants.js";
import { LEVEL_START, legacyLevelFor, levelFor } from "./economy.js";
import { uid } from "./format.js";
import { FREEZE_REFUND_CRYSTALS, PENALTY_TAG, firstUseDate, penaltyFloorDate } from "./penalty.js";
import { totalXp } from "./stats.js";
import { dateKey } from "./time.js";

function stripMustDoQuests(state) {
  let removed = 0;
  for (const key of Object.keys(state.days || {})) {
    const day = state.days[key];
    if (!day?.slots) continue;
    for (const slot of SLOTS) {
      const list = day.slots[slot] || [];
      const kept = list.filter((task) => task?.penaltyTag !== PENALTY_TAG);
      removed += list.length - kept.length;
      day.slots[slot] = kept;
    }
  }
  return removed;
}

function phantomPenaltyState(state, today) {
  const started = state.startedOn || today;
  const since = state.penaltySince || started;
  if (since < started) return true;
  if ((state.penaltyProcessed || []).some((d) => d < started)) return true;
  if ((state.penaltyReports || []).some((r) => (r.dates || []).some((d) => d < started))) return true;
  if ((state.lastPenaltyReport?.dates || []).some((d) => d < started)) return true;
  return false;
}

function migratePhantomPenalties(state, now) {
  const today = dateKey(now);
  const started = state.startedOn || today;
  const use = firstUseDate(state, today);
  const floor = use > penaltyFloorDate(state, today) ? use : penaltyFloorDate(state, today);
  const phantom = phantomPenaltyState(state, today);

  state.penaltyProcessed = (state.penaltyProcessed || []).filter((d) => d >= floor);
  state.penaltyReports = (state.penaltyReports || []).filter(
    (r) => !(r.dates || []).some((d) => d < floor),
  );

  if (phantom) {
    stripMustDoQuests(state);
    state.lastPenaltyReport = null;
    state.penaltySince = today;
    if (Number(state.crystalStress) > 0) state.crystalStress = 0;
    if (state.streakBrokenAt && state.streakBrokenAt < floor) delete state.streakBrokenAt;
  } else if ((state.penaltySince || started) < started) {
    state.penaltySince = today;
  }

  state.grants = { ...(state.grants || {}), penaltyPhantomV1: true };
  return state;
}

/**
 * Runtime migration for saves still on v1 freeze/shop shape.
 * Safe to call on every load and import.
 */
export function migrateStateV2(state, now = new Date()) {
  if (!state || typeof state !== "object") return state;
  const next = structuredClone(state);

  next.settings = next.settings || {};
  if (next.settings.soundVolume == null) {
    next.settings.soundVolume = 0.8;
  }
  if (next.settings.sound === undefined) {
    next.settings.sound = true;
  }
  if (!next.settings.crystalSkin) next.settings.crystalSkin = "default";
  if (!next.settings.checkFx) next.settings.checkFx = "shards";
  if (!next.settings.soundPack) next.settings.soundPack = "system";

  next.ownedSkins = Array.isArray(next.ownedSkins) ? next.ownedSkins : ["default"];
  next.ownedTitles = Array.isArray(next.ownedTitles) ? next.ownedTitles : [];
  next.ownedBadges = Array.isArray(next.ownedBadges) ? next.ownedBadges : [];
  next.ownedFx = Array.isArray(next.ownedFx) ? next.ownedFx : ["shards"];
  next.ownedSoundPacks = Array.isArray(next.ownedSoundPacks) ? next.ownedSoundPacks : ["system"];
  next.customRewards = Array.isArray(next.customRewards) ? next.customRewards : [];
  next.penaltyProcessed = Array.isArray(next.penaltyProcessed) ? next.penaltyProcessed : [];
  next.penaltyReports = Array.isArray(next.penaltyReports) ? next.penaltyReports : [];
  next.crystalStress = Math.max(0, Math.min(1, Number(next.crystalStress) || 0));
  const since = String(next.penaltySince || "").match(/^\d{4}-\d{2}-\d{2}$/) ? next.penaltySince : "";
  if (!since) next.penaltySince = dateKey(now);

  const freezeCount = Math.max(0, Math.round(Number(next.freezes) || 0));
  if (freezeCount > 0 && !next.grants?.freezeMigrated) {
    const refund = freezeCount * FREEZE_REFUND_CRYSTALS;
    next.crystals = Math.max(0, (Number(next.crystals) || 0) + refund);
    next.crystalLog = next.crystalLog || [];
    next.crystalLog.unshift({
      at: new Date().toISOString(),
      delta: refund,
      reason: "freeze-refund",
    });
    next.crystalLog = next.crystalLog.slice(0, 80);
    next.grants = { ...(next.grants || {}), freezeMigrated: true };
  }
  delete next.freezes;
  delete next.freezeLog;

  if (next.version == null) next.version = 1;

  if (!next.grants?.progressionV3) {
    const xp = totalXp(next);
    const oldLevel = legacyLevelFor(xp);
    const newLevel = levelFor(xp);
    if (newLevel < oldLevel) {
      const target = LEVEL_START[Math.max(0, oldLevel - 1)] || 0;
      const bump = target - xp;
      if (bump > 0) {
        next.xpEvents = next.xpEvents || [];
        next.xpEvents.push({
          id: uid(),
          at: new Date().toISOString(),
          date: dateKey(now),
          amount: bump,
          source: "migration",
          ref: "progression-v3",
        });
      }
    }
    next.grants = { ...(next.grants || {}), progressionV3: true };
  }

  if (!next.grants?.penaltyPhantomV1) {
    migratePhantomPenalties(next, now);
  }

  return next;
}