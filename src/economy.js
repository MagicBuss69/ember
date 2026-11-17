import { LEVEL_START as LEGACY_LEVEL_START, XP_TASK, XP_WORKOUT } from "./constants.js";

export { LEGACY_LEVEL_START };

/**
 * Levels never end. Levels 1–10 keep the exact thresholds they always had, so
 * nobody's level moves. Past level 10 each span grows 8% on the last one,
 * rounded to 10 XP, which outpaces the +10%-of-base quest reward growth.
 */
export const LEVEL_GROWTH = 1.08;
const EARLY_LEVELS = 10;

function earlySpan(level) {
  const l = Math.max(1, Math.min(EARLY_LEVELS - 1, level));
  const curved = Math.round(52 + 30 * (l - 1) + 8 * Math.pow(l - 1, 1.35));
  const legacySpan = LEGACY_LEVEL_START[l] - LEGACY_LEVEL_START[l - 1];
  return Math.max(curved, legacySpan);
}

function buildEarlyStarts() {
  const starts = [0];
  let prevSpan = 0;
  for (let level = 1; level < EARLY_LEVELS; level += 1) {
    let span = earlySpan(level);
    if (level > 1) span = Math.max(span, prevSpan + 8);
    prevSpan = span;
    starts.push(starts[level - 1] + span);
  }
  for (let i = 0; i < EARLY_LEVELS; i += 1) {
    starts[i] = Math.max(starts[i], LEGACY_LEVEL_START[i] || 0);
  }
  for (let i = 1; i < EARLY_LEVELS; i += 1) {
    if (starts[i] <= starts[i - 1]) starts[i] = starts[i - 1] + prevSpan;
  }
  return starts;
}

/** Total XP to arrive at level index+1. Grows on demand; never read past its length directly. */
const STARTS = buildEarlyStarts();

function extendTo(index) {
  while (STARTS.length <= index) {
    const n = STARTS.length;
    const prevSpan = STARTS[n - 1] - STARTS[n - 2];
    const span = Math.round((prevSpan * LEVEL_GROWTH) / 10) * 10;
    STARTS.push(STARTS[n - 1] + Math.max(prevSpan + 10, span));
  }
}

/** The first ten thresholds (levels 1–10), kept for older callers and tests. */
export const LEVEL_START = STARTS.slice(0, EARLY_LEVELS);

/** Total XP needed to reach `level` (level 1 = 0). Works for any level. */
export function levelStart(level) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  extendTo(l - 1);
  return STARTS[l - 1];
}

/** XP needed to go from `level` → `level + 1` (increases every level, forever). */
export function xpSpanToNextLevel(level) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  return levelStart(l + 1) - levelStart(l);
}

export function levelFor(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (levelStart(level + 1) <= total) level += 1;
  return level;
}

/** Old v1 thresholds (capped at 10). Only used by the one-time progression migration. */
export function legacyLevelFor(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let i = 0; i < LEGACY_LEVEL_START.length; i += 1) {
    if (total >= LEGACY_LEVEL_START[i]) level = i + 1;
  }
  return Math.min(10, level);
}

function rewardLevel(level) {
  return Math.max(1, Math.floor(Number(level) || 1));
}

/** Quest XP scales with current level so late levels stay meaningful (+10% of base per level). */
export function questXpForLevel(level) {
  const l = rewardLevel(level);
  return Math.round(XP_TASK * (1 + 0.1 * (l - 1)));
}

/** Workout XP scales with level exactly like quest XP (+10% of base per level above 1). */
export function workoutXpForLevel(level) {
  const l = rewardLevel(level);
  return Math.round(XP_WORKOUT * (1 + 0.1 * (l - 1)));
}

export function levelProgress(xp) {
  const total = Math.max(0, Number(xp) || 0);
  const level = levelFor(total);
  const at = levelStart(level);
  const next = levelStart(level + 1);
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
