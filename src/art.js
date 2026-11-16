/** Catalog / art basename mapping (shop id → webp filename without extension). */
export function catalogArtId(id) {
  if (id === "badge-full") return "badge-fullday";
  return id;
}

const BASE = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/ember/";

export const ART_WEBP = [
  "badge-fullday",
  "badge-streak7",
  "currency",
  "fx-nova",
  "fx-shards",
  "life-reward",
  "skin-ember",
  "skin-ice",
  "skin-void",
  "sound-arcade",
  "sound-chime",
  "theme-aurora",
  "theme-blood",
  "theme-ember",
  "theme-frost",
  "theme-ink",
  "theme-pine",
  "title-hunter",
  "title-monarch",
  "title-shadow",
];

export function artUrl(artId) {
  return `${BASE}art/${catalogArtId(artId)}.webp`;
}

function imgTag({ src, className, alt, displaySize, eager = false }) {
  const d = Math.round(displaySize);
  const px = d * 2;
  const load = eager ? "eager" : "lazy";
  const altAttr = alt != null && alt !== "" ? ` alt="${String(alt).replace(/"/g, "&quot;")}"` : ' alt=""';
  return `<img class="${className}" src="${src}"${altAttr} width="${px}" height="${px}" loading="${load}" decoding="async" style="width:${d}px;height:${d}px" />`;
}

/** Hex gold coin — currency (not the blue level crystal). */
export function currencyIcon({ size = 20, className = "currency-art", eager = false } = {}) {
  return imgTag({ src: artUrl("currency"), className, alt: "", displaySize: size, eager });
}

export function gemIcon(opts = {}) {
  return currencyIcon(opts);
}

/** Shop / settings item thumbnail (fills `.item-thumb` when className is `item-art-fill`). */
export function itemThumb(artId, { alt = "", fill = true, size = 44, eager = false, hue = 0 } = {}) {
  const d = Math.round(size);
  const px = d * 2;
  const src = artUrl(artId);
  const load = eager ? "eager" : "lazy";
  const altAttr = alt ? ` alt="${String(alt).replace(/"/g, "&quot;")}"` : ' alt=""';
  const cls = fill ? "item-art-fill" : "item-art";
  const inner = fill
    ? `<img class="${cls}" src="${src}"${altAttr} width="${px}" height="${px}" loading="${load}" decoding="async" />`
    : imgTag({ src, className: cls, alt: alt || "", displaySize: d, eager });
  const shift = Math.round(Number(hue) || 0) % 360;
  if (shift) return `<span class="item-thumb is-tinted" style="--art-hue:${shift}deg">${inner}</span>`;
  return `<span class="item-thumb">${inner}</span>`;
}