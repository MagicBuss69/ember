import { levelFor } from "./economy.js";

/** Solo Leveling–style ranks tied to level bands. */
export const RANK_BANDS = [
  { rank: "E", minLevel: 1, maxLevel: 2, label: "Rank E — Novice Hunter" },
  { rank: "D", minLevel: 3, maxLevel: 4, label: "Rank D — Rising" },
  { rank: "C", minLevel: 5, maxLevel: 6, label: "Rank C — Proven" },
  { rank: "B", minLevel: 7, maxLevel: 8, label: "Rank B — Elite" },
  { rank: "A", minLevel: 9, maxLevel: 9, label: "Rank A — Monarch's eye" },
  { rank: "S", minLevel: 10, maxLevel: 10, label: "Rank S — Shadow Monarch" },
];

export function rankForLevel(level) {
  const lv = Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
  const band = RANK_BANDS.find((item) => lv >= item.minLevel && lv <= item.maxLevel) || RANK_BANDS[0];
  return band.rank;
}

export function rankForXp(xp) {
  return rankForLevel(levelFor(xp));
}

export function rankMeta(level) {
  const lv = Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
  return RANK_BANDS.find((item) => lv >= item.minLevel && lv <= item.maxLevel) || RANK_BANDS[0];
}

/** Next rank threshold level, or null at S. */
export function nextRankLevel(level) {
  const meta = rankMeta(level);
  const idx = RANK_BANDS.findIndex((item) => item.rank === meta.rank);
  if (idx < 0 || idx >= RANK_BANDS.length - 1) return null;
  return RANK_BANDS[idx + 1].minLevel;
}