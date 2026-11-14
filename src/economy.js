import { LEVEL_START as LEGACY_LEVEL_START, XP_TASK } from "./constants.js";

export { LEGACY_LEVEL_START };

/** XP needed to go from `level` → `level + 1` (increases every level). */
export function xpSpanToNextLevel(level) {
  const l = Math.max(1, Math.min(9, Number(level) || 1));
  const curved = Math.round(52 + 30 * (l - 1) + 8 * Math.pow(l - 1, 1.35));
  const legacySpan = LEGACY_LEVEL_START[l] - LEGACY_LEVEL_START[l - 1];
  return Math.max(curved, legacySpan);
}

function buildLevelStart(maxLevel = 10) {
  const starts = [0];
  let prevSpan = 0;
  for (let level = 1; level < maxLevel; level += 1) {
    let span = xpSpanToNextLevel(level);
    if (level > 1) span = Math.max(span, prevSpan + 8);
    prevSpan = span;
    starts.push(starts[level - 1] + span);
  }
  for (let i = 0; i < maxLevel; i += 1) {
    starts[i] = Math.max(starts[i], LEGACY_LEVEL_START[i] || 0);
  }
  for (let i = 1; i < maxLevel; i += 1) {
    if (starts[i] <= starts[i - 1]) starts[i] = starts[i - 1] + prevSpan;
  }
  return starts;
}

export const LEVEL_START = buildLevelStart(10);

export function levelFor(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let i = 0; i < LEVEL_START.length; i += 1) {
    if (total >= LEVEL_START[i]) level = i + 1;
  }
  return Math.min(10, level);
}

export function legacyLevelFor(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let i = 0; i < LEGACY_LEVEL_START.length; i += 1) {
    if (total >= LEGACY_LEVEL_START[i]) level = i + 1;
  }
  return Math.min(10, level);
}

/** Quest XP scales with current level so late levels stay meaningful. */
export function questXpForLevel(level) {
  const l = Math.max(1, Math.min(10, Number(level) || 1));
  return Math.round(XP_TASK * (1 + 0.1 * (l - 1)));
}

export function levelProgress(xp) {
  const total = Math.max(0, Number(xp) || 0);
  const level = levelFor(total);
  if (level >= 10) {
    return {
      level,
      maxed: true,
      into: total - LEVEL_START[9],
      span: 0,
      pct: 1,
      next: null,
      at: LEVEL_START[9],
    };
  }
  const at = LEVEL_START[level - 1];
  const next = LEVEL_START[level];
  const span = next - at;
  const into = total - at;
  return {
    level,
    maxed: false,
    into,
    span,
    pct: span === 0 ? 1 : Math.min(1, into / span),
    next,
    at,
  };
}