/** Intersection visibility of the expanded Today board inside #main (0–1). */
export function intersectionRatio(rootRect, targetRect) {
  const visibleTop = Math.max(targetRect.top, rootRect.top);
  const visibleBottom = Math.min(targetRect.bottom, rootRect.bottom);
  const visible = Math.max(0, visibleBottom - visibleTop);
  const height = Math.max(targetRect.height, 1);
  return visible / height;
}

export function compactBarVisible(ratio, threshold = 0.15) {
  return ratio < threshold;
}