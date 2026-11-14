import { THEMES } from "./constants.js";
import { uid } from "./format.js";

export const SHOP_CATEGORIES = [
  { id: "themes", label: "Themes" },
  { id: "crystal", label: "Crystal skins" },
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
  })),
  { id: "skin-ice", category: "crystal", kind: "skin", skinId: "ice", name: "Ice Shard", blurb: "Frost-blue crystal.", price: 12 },
  { id: "skin-ember", category: "crystal", kind: "skin", skinId: "ember", name: "Ember Core", blurb: "Warm magma glow.", price: 12 },
  { id: "skin-void", category: "crystal", kind: "skin", skinId: "void", name: "Void Glass", blurb: "Ink-black with gold fracture.", price: 18 },
  { id: "title-hunter", category: "titles", kind: "title", titleId: "hunter", name: "Hunter", blurb: "Display title.", price: 8 },
  { id: "title-shadow", category: "titles", kind: "title", titleId: "shadow", name: "Shadow", blurb: "For quiet grinders.", price: 14 },
  { id: "title-monarch", category: "titles", kind: "title", titleId: "monarch", name: "Monarch", blurb: "Endgame flex.", price: 24 },
  { id: "badge-streak7", category: "badges", kind: "badge", badgeId: "streak7", name: "7-day flame", blurb: "Profile badge.", price: 10 },
  { id: "badge-full", category: "badges", kind: "badge", badgeId: "fullday", name: "Full day", blurb: "Cleared every quest.", price: 10 },
  { id: "fx-shards", category: "fx", kind: "fx", fxId: "shards", name: "Crystal shards", blurb: "Shard burst on check.", price: 15 },
  { id: "fx-nova", category: "fx", kind: "fx", fxId: "nova", name: "Nova ring", blurb: "Wider pulse.", price: 15 },
  { id: "sound-chime", category: "sound", kind: "soundPack", soundPackId: "chime", name: "Glass chime", blurb: "Crisp check sound.", price: 12 },
  { id: "sound-arcade", category: "sound", kind: "soundPack", soundPackId: "arcade", name: "Arcade", blurb: "Retro combo line.", price: 12 },
];

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

export function addCustomReward(state, { title, price }, now = new Date()) {
  const next = structuredClone(state);
  const name = String(title || "").trim().slice(0, 60);
  const cost = Math.max(1, Math.min(999, Math.round(Number(price) || 0)));
  if (!name) return { state: next, ok: false };
  next.customRewards = next.customRewards || [];
  next.customRewards.push({ id: uid(), title: name, price: cost, createdAt: now.toISOString() });
  next.customRewards = next.customRewards.slice(-40);
  return { state: next, ok: true };
}

export function redeemCustomReward(state, rewardId, now = new Date()) {
  const next = structuredClone(state);
  const reward = (next.customRewards || []).find((item) => item.id === rewardId);
  if (!reward) return { state: next, ok: false };
  if ((next.crystals || 0) < reward.price) return { state: next, ok: false };
  next.crystals -= reward.price;
  next.crystalLog.unshift({
    at: now.toISOString(),
    delta: -reward.price,
    reason: `life-${reward.id}`,
  });
  next.crystalLog = next.crystalLog.slice(0, 80);
  return { state: next, ok: true };
}

export function equipCosmetic(state, patch) {
  const next = structuredClone(state);
  if (patch.crystalSkin && (next.ownedSkins || []).includes(patch.crystalSkin)) {
    next.settings.crystalSkin = patch.crystalSkin;
  }
  if (patch.title && (next.ownedTitles || []).includes(patch.title)) {
    next.settings.equippedTitle = patch.title;
  }
  if (patch.fx && (next.ownedFx || []).includes(patch.fx)) {
    next.settings.checkFx = patch.fx;
  }
  if (patch.soundPack && (next.ownedSoundPacks || []).includes(patch.soundPack)) {
    next.settings.soundPack = patch.soundPack;
  }
  return next;
}