import { LEVEL_START } from "./constants.js";

export function levelFor(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let i = 0; i < LEVEL_START.length; i += 1) {
    if (total >= LEVEL_START[i]) level = i + 1;
  }
  return Math.min(10, level);
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
