import { THEMES } from "./constants.js";
import { uid } from "./format.js";
import { clampUnlockMinutesValue, redeemLifeReward } from "./lifeRewards.js";

export const SHOP_CATEGORIES = [
  { id: "themes", label: "Themes" },
  { id: "crystal", label: "Emblem skins" },
  { id: "titles", label: "Titles" },
  { id: "badges", label: "Badges" },
  { id: "fx", label: "Check FX" },
  { id: "sound", label: "Sound packs" },
  { id: "life", label: "Real-life rewards" },
];

/** Static catalog; life rewards are user-defined in state.customRewards */
export const SHOP_CATALOG = [
  ...THEMES.filter((t) => t.price > 0).map((t) => ({
    id: `theme-${t.id}`,
    category: "themes",
    kind: "theme",
    themeId: t.id,
    name: t.name,
    blurb: t.blurb,
    price: t.price,
    ...(t.art ? { art: t.art, hue: t.hue || 0 } : {}),
  })),
  { id: "skin-ice", category: "crystal", kind: "skin", skinId: "ice", name: "Ice Shard", blurb: "Frost-blue aura on your rank emblem.", price: 12 },
  { id: "skin-ember", category: "crystal", kind: "skin", skinId: "ember", name: "Ember Core", blurb: "Warm magma glow on your rank emblem.", price: 12 },
  { id: "skin-void", category: "crystal", kind: "skin", skinId: "void", name: "Void Glass", blurb: "Ink-black frame with a gold edge.", price: 18 },
  { id: "skin-emerald", category: "crystal", kind: "skin", skinId: "emerald", name: "Emerald Heart", blurb: "Deep green emblem glow.", price: 14, art: "skin-ice", hue: 280 },
  { id: "skin-ruby", category: "crystal", kind: "skin", skinId: "ruby", name: "Ruby Fang", blurb: "Blood-red emblem aura.", price: 16, art: "skin-ember", hue: 340 },
  { id: "skin-amethyst", category: "crystal", kind: "skin", skinId: "amethyst", name: "Amethyst Rune", blurb: "Violet emblem aura, soft pulse.", price: 16, art: "skin-ice", hue: 70 },
  { id: "skin-solar", category: "crystal", kind: "skin", skinId: "solar", name: "Solar Flare", blurb: "Molten gold, loud emblem glow.", price: 22, art: "skin-ember", hue: 25 },
  { id: "skin-sakura", category: "crystal", kind: "skin", skinId: "sakura", name: "Sakura Glass", blurb: "Pale pink emblem bloom.", price: 20, art: "skin-ice", hue: 130 },
  { id: "title-hunter", category: "titles", kind: "title", titleId: "hunter", name: "Hunter", blurb: "Display title.", price: 8 },
  { id: "title-shadow", category: "titles", kind: "title", titleId: "shadow", name: "Shadow", blurb: "For quiet grinders.", price: 14 },
  { id: "title-monarch", category: "titles", kind: "title", titleId: "monarch", name: "Monarch", blurb: "Endgame flex.", price: 24 },
  { id: "title-awakened", category: "titles", kind: "title", titleId: "awakened", name: "Awakened", blurb: "The System noticed you.", price: 6, art: "title-hunter", hue: 200 },
  { id: "title-ironwill", category: "titles", kind: "title", titleId: "ironwill", name: "Iron Will", blurb: "Never skips leg day.", price: 12, art: "title-shadow", hue: 160 },
  { id: "title-nightowl", category: "titles", kind: "title", titleId: "nightowl", name: "Night Owl", blurb: "Grinds after dark.", price: 10, art: "title-shadow", hue: 60 },
  { id: "title-unbroken", category: "titles", kind: "title", titleId: "unbroken", name: "Unbroken", blurb: "Streaks don't die here.", price: 18, art: "title-monarch", hue: 120 },
  { id: "title-sovereign", category: "titles", kind: "title", titleId: "sovereign", name: "Sovereign", blurb: "Above the Monarch.", price: 30, art: "title-monarch", hue: 300 },
  { id: "badge-streak7", category: "badges", kind: "badge", badgeId: "streak7", name: "7-day flame", blurb: "Profile badge.", price: 10 },
  { id: "badge-full", category: "badges", kind: "badge", badgeId: "fullday", name: "Full day", blurb: "Cleared every quest.", price: 10 },
  { id: "badge-earlybird", category: "badges", kind: "badge", badgeId: "earlybird", name: "Early bird", blurb: "Up before the alarm.", price: 8, art: "badge-fullday", hue: 40 },
  { id: "badge-ironlungs", category: "badges", kind: "badge", badgeId: "ironlungs", name: "Iron lungs", blurb: "Cardio regular.", price: 12, art: "badge-streak7", hue: 180 },
  { id: "badge-rivalslayer", category: "badges", kind: "badge", badgeId: "rivalslayer", name: "Rival slayer", blurb: "Beat Noah once. Probably.", price: 16, art: "badge-streak7", hue: 300 },
  { id: "fx-shards", category: "fx", kind: "fx", fxId: "shards", name: "Crystal shards", blurb: "Shard burst on check.", price: 15 },
  { id: "fx-nova", category: "fx", kind: "fx", fxId: "nova", name: "Nova ring", blurb: "Wider pulse.", price: 15 },
  { id: "fx-embers", category: "fx", kind: "fx", fxId: "embers", name: "Ember sparks", blurb: "Hot orange sparks.", price: 14, art: "fx-nova", hue: 330 },
  { id: "fx-frostbite", category: "fx", kind: "fx", fxId: "frostbite", name: "Frostbite", blurb: "Icy blue spray.", price: 16, art: "fx-shards", hue: 180 },
  { id: "fx-supernova", category: "fx", kind: "fx", fxId: "supernova", name: "Supernova", blurb: "Huge, loud, gold.", price: 24, art: "fx-nova", hue: 30 },
  { id: "sound-chime", category: "sound", kind: "soundPack", soundPackId: "chime", name: "Glass chime", blurb: "Crisp check sound.", price: 12 },
  { id: "sound-arcade", category: "sound", kind: "soundPack", soundPackId: "arcade", name: "Arcade", blurb: "Retro combo line.", price: 12 },
  { id: "sound-bell", category: "sound", kind: "soundPack", soundPackId: "bell", name: "Temple bell", blurb: "Deep, calm ring.", price: 14, art: "sound-chime", hue: 40 },
  { id: "sound-laser", category: "sound", kind: "soundPack", soundPackId: "laser", name: "Laser zap", blurb: "Sci-fi pew on check.", price: 14, art: "sound-arcade", hue: 120 },
  { id: "sound-marimba", category: "sound", kind: "soundPack", soundPackId: "marimba", name: "Marimba", blurb: "Warm wooden pops.", price: 16, art: "sound-chime", hue: 300 },
];

/** Art for an item: its own webp, or an existing one tinted with a hue shift. */
export function itemArt(item) {
  if (!item) return { art: "life-reward", hue: 0 };
  return { art: item.art || item.id, hue: Number(item.hue) || 0 };
}

/** Display name for an owned title or badge id. */
export function catalogName(kind, value) {
  const key = kind === "title" ? "titleId" : kind === "badge" ? "badgeId" : "";
  const hit = key ? SHOP_CATALOG.find((item) => item.kind === kind && item[key] === value) : null;
  return hit ? hit.name : String(value || "");
}

export function catalogForCategory(categoryId) {
  return SHOP_CATALOG.filter((item) => item.category === categoryId);
}

function ownedKey(kind) {
  const map = {
    theme: "ownedThemes",
    skin: "ownedSkins",
    title: "ownedTitles",
    badge: "ownedBadges",
    fx: "ownedFx",
    soundPack: "ownedSoundPacks",
  };
  return map[kind];
}

export function isOwned(state, item) {
  const key = ownedKey(item.kind);
  if (!key) return false;
  const list = state[key] || [];
  switch (item.kind) {
    case "theme":
      return list.includes(item.themeId);
    case "skin":
      return list.includes(item.skinId);
    case "title":
      return list.includes(item.titleId);
    case "badge":
      return list.includes(item.badgeId);
    case "fx":
      return list.includes(item.fxId);
    case "soundPack":
      return list.includes(item.soundPackId);
    default:
      return false;
  }
}

export function buyItem(state, itemId, now = new Date()) {
  const item = SHOP_CATALOG.find((entry) => entry.id === itemId);
  const next = structuredClone(state);
  if (!item) return { state: next, ok: false, reason: "missing" };
  if (isOwned(next, item)) return { state: next, ok: false, reason: "owned" };
  if ((next.crystals || 0) < item.price) return { state: next, ok: false, reason: "poor" };

  next.crystals -= item.price;
  const key = ownedKey(item.kind);
  if (key) {
    next[key] = [...(next[key] || [])];
    const value =
      item.themeId || item.skinId || item.titleId || item.badgeId || item.fxId || item.soundPackId;
    if (value && !next[key].includes(value)) next[key].push(value);
  }

  if (item.kind === "theme" && item.themeId) next.settings.theme = item.themeId;

  next.crystalLog = next.crystalLog || [];
  next.crystalLog.unshift({
    at: now.toISOString(),
    delta: -item.price,
    reason: `shop-${item.id}`,
  });
  next.crystalLog = next.crystalLog.slice(0, 80);
  return { state: next, ok: true };
}

export function addCustomReward(state, { title, price, unlockMinutes = 0, oneTime = false }, now = new Date()) {
  const next = structuredClone(state);
  const name = String(title || "").trim().slice(0, 60);
  const cost = Math.max(1, Math.min(999, Math.round(Number(price) || 0)));
  if (!name) return { state: next, ok: false };
  next.customRewards = next.customRewards || [];
  next.customRewards.push({
    id: uid(),
    title: name,
    price: cost,
    unlockMinutes: clampUnlockMinutesValue(unlockMinutes),
    oneTime: oneTime === true,
    createdAt: now.toISOString(),
  });
  next.customRewards = next.customRewards.slice(-40);
  return { state: next, ok: true };
}

export function removeCustomReward(state, rewardId) {
  const next = structuredClone(state);
  const before = (next.customRewards || []).length;
  next.customRewards = (next.customRewards || []).filter((item) => item.id !== rewardId);
  if (next.customRewards.length === before) return { state: next, ok: false };
  return { state: next, ok: true };
}

/** Kept for callers and tests; handles custom rewards and rotating offers. */
export function redeemCustomReward(state, rewardId, now = new Date()) {
  return redeemLifeReward(state, rewardId, now);
}

export function equipCosmetic(state, patch) {
  const next = structuredClone(state);
  if (patch.crystalSkin && (next.ownedSkins || []).includes(patch.crystalSkin)) {
    next.settings.crystalSkin = patch.crystalSkin;
  }
  if (patch.equippedTitle && (next.ownedTitles || []).includes(patch.equippedTitle)) {
    next.settings.equippedTitle = patch.equippedTitle;
  }
  if (patch.checkFx && (next.ownedFx || []).includes(patch.checkFx)) {
    next.settings.checkFx = patch.checkFx;
  }
  if (patch.soundPack && (next.ownedSoundPacks || []).includes(patch.soundPack)) {
    next.settings.soundPack = patch.soundPack;
  }
  return next;
}