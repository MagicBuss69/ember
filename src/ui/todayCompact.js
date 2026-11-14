/** Default scroll cutoff when the expanded board node is missing. */
export const COMPACT_BAR_FALLBACK_SCROLL = 140;
export const COMPACT_BAR_PEEK_PX = 60;

/** True when scrollTop has passed the expanded board bottom minus a small peek strip. */
export function compactBarFromScroll(scrollTop, expandedBottom, peek = COMPACT_BAR_PEEK_PX, fallback = COMPACT_BAR_FALLBACK_SCROLL) {
  if (!Number.isFinite(expandedBottom) || expandedBottom <= 0) return scrollTop > fallback;
  const cutoff = Math.max(peek, expandedBottom - peek);
  return scrollTop > cutoff;
}