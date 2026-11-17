import { levelFor } from "./economy.js";

/**
 * Rank tiers tied to level bands. The named tiers end at Grandmaster; after that
 * Legend I, II, III… keep coming every 5 levels, so the ladder never runs out.
 */
export const RANK_TIERS = [
  { id: "bronze", name: "Bronze", minLevel: 1, maxLevel: 3, shape: "shield", marks: 1, colors: ["#ffd9ae", "#c9813f", "#5c2f10"], glow: "#e08a45", motto: "First steps" },
  { id: "silver", name: "Silver", minLevel: 4, maxLevel: 6, shape: "shield", marks: 2, colors: ["#ffffff", "#b3bfce", "#465062"], glow: "#c9d6e8", motto: "Finding the rhythm" },
  { id: "gold", name: "Gold", minLevel: 7, maxLevel: 9, shape: "shield", marks: 3, colors: ["#fff5b8", "#eab92a", "#6b4504"], glow: "#ffcf3a", motto: "Proven" },
  { id: "platinum", name: "Platinum", minLevel: 10, maxLevel: 14, shape: "gem", colors: ["#f0fffc", "#7fdcca", "#1a5752"], glow: "#7fe8d6", motto: "Elite" },
  { id: "diamond", name: "Diamond", minLevel: 15, maxLevel: 19, shape: "gem", colors: ["#f2fbff", "#62bfff", "#123a86"], glow: "#5cc2ff", motto: "Unbreakable" },
  { id: "master", name: "Master", minLevel: 20, maxLevel: 24, shape: "crown", colors: ["#f7e4ff", "#b26cff", "#38106b"], glow: "#b77bff", motto: "Few get here" },
  { id: "grandmaster", name: "Grandmaster", minLevel: 25, maxLevel: 29, shape: "crown", colors: ["#ffe0da", "#ff5b5b", "#640d16"], glow: "#ff6a5a", motto: "Monarch's eye" },
];

export const LEGEND_START = 30;
export const LEGEND_SPAN = 5;
const LEGEND = { name: "Legend", shape: "crown", colors: ["#fff3c4", "#ff9a3c", "#3a1048"], glow: "#ffb44a", motto: "Shadow Monarch" };

/** Kept for older imports: the named tiers. */
export const RANK_BANDS = RANK_TIERS;

const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function roman(n) {
  let left = Math.max(1, Math.floor(n));
  let out = "";
  for (const [value, glyph] of ROMAN) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

function clampLevel(level) {
  return Math.max(1, Math.floor(Number(level) || 1));
}

/** Everything the UI needs about the rank at `level`. */
export function rankMeta(level) {
  const lv = clampLevel(level);
  const tier = RANK_TIERS.find((item) => lv >= item.minLevel && lv <= item.maxLevel);
  if (tier) {
    const index = RANK_TIERS.indexOf(tier);
    return {
      ...tier,
      rank: tier.id,
      index,
      numeral: "",
      span: tier.maxLevel - tier.minLevel + 1,
      step: lv - tier.minLevel + 1,
      label: `${tier.name} · ${tier.motto}`,
    };
  }
  const n = Math.floor((lv - LEGEND_START) / LEGEND_SPAN) + 1;
  const minLevel = LEGEND_START + (n - 1) * LEGEND_SPAN;
  const name = `Legend ${roman(n)}`;
  return {
    ...LEGEND,
    id: `legend-${n}`,
    rank: `legend-${n}`,
    name,
    index: RANK_TIERS.length + n - 1,
    numeral: roman(n),
    minLevel,
    maxLevel: minLevel + LEGEND_SPAN - 1,
    span: LEGEND_SPAN,
    step: lv - minLevel + 1,
    label: `${name} · ${LEGEND.motto}`,
  };
}

/** Stable rank id for a level ("bronze" … "grandmaster", then "legend-1", "legend-2", …). */
export function rankForLevel(level) {
  return rankMeta(level).id;
}

export function rankForXp(xp) {
  return rankForLevel(levelFor(xp));
}

/** First level of the next rank. Always exists: the ladder never ends. */
export function nextRankLevel(level) {
  return rankMeta(level).maxLevel + 1;
}

let emblemSeq = 0;

const SHAPES = {
  shield: {
    body: "M24 3.5 41 9.5V23c0 10.6-7.4 17.6-17 21.5C14.4 40.6 7 33.6 7 23V9.5Z",
    inner: "M24 7.6 37.4 12.3V23c0 8.4-5.6 14.2-13.4 17.6C16.2 37.2 10.6 31.4 10.6 23V12.3Z",
    facets: "",
  },
  gem: {
    body: "M24 2.5 43 13.5v21L24 45.5 5 34.5v-21Z",
    inner: "M24 6.6 39.4 15.5v17L24 41.4 8.6 32.5v-17Z",
    facets: "",
    jewel: true,
  },
  crown: {
    body: "M8.5 15.5h31l6.5 8L24 46 2 23.5Z",
    inner: "",
    facets: "M2 23.5h44M8.5 15.5l7.5 8 8-8 8 8 7.5-8M16 23.5 24 46l8-22.5",
    crown: "M9 13.5 7.5 4.5l7.6 4.7L24 2l8.9 7.2 7.6-4.7L39 13.5Z",
  },
};

/** Rank emblem as inline SVG. Tier colours are fixed so it reads the same on every theme and skin. */
export function rankEmblemSvg(level, { size = 40, className = "" } = {}) {
  const meta = typeof level === "object" && level ? level : rankMeta(level);
  const shape = SHAPES[meta.shape] || SHAPES.shield;
  const [light, mid, dark] = meta.colors;
  emblemSeq += 1;
  const id = `rk${emblemSeq}`;
  const legend = meta.id.startsWith("legend");
  const fillStops = legend
    ? `<stop offset="0" stop-color="#fff3c4"/><stop offset="0.45" stop-color="#ff9a3c"/><stop offset="0.75" stop-color="#ff4fa8"/><stop offset="1" stop-color="#6b3bff"/>`
    : `<stop offset="0" stop-color="${light}"/><stop offset="0.5" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/>`;
  const marks = meta.marks
    ? Array.from({ length: meta.marks }, (_, i) => {
        const y = 17 + i * 6.2 - (meta.marks - 1) * 3.1;
        return `<path d="M16.5 ${y.toFixed(1)} 24 ${(y + 5).toFixed(1)} 31.5 ${y.toFixed(1)}" fill="none" stroke="${light}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 ${y.toFixed(1)} 24 ${(y + 5).toFixed(1)} 31.5 ${y.toFixed(1)}" fill="none" stroke="${dark}" stroke-opacity="0.35" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1.1)"/>`;
      }).join("")
    : "";
  const numeral = meta.numeral
    ? `<text x="24" y="${meta.shape === "crown" ? 33 : 30}" text-anchor="middle" dominant-baseline="middle" font-size="${meta.numeral.length > 3 ? 8 : 11}" font-weight="800" fill="#fff" stroke="${dark}" stroke-width="2.2" paint-order="stroke" font-family="Outfit, system-ui, sans-serif">${meta.numeral}</text>`
    : "";
  return `<svg class="rank-emblem ${className}" data-rank="${meta.id}" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${meta.name} rank" style="--rank-glow:${meta.glow}">
    <defs>
      <linearGradient id="${id}f" x1="0.2" y1="0" x2="0.8" y2="1">${fillStops}</linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    ${shape.crown ? `<path d="${shape.crown}" fill="url(#${id}f)" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="24" cy="2.8" r="1.6" fill="${light}"/><circle cx="7.6" cy="5" r="1.3" fill="${light}"/><circle cx="40.4" cy="5" r="1.3" fill="${light}"/>` : ""}
    <path d="${shape.body}" fill="url(#${id}f)" stroke="${dark}" stroke-width="1.8" stroke-linejoin="round"/>
    ${shape.inner ? `<path d="${shape.inner}" fill="none" stroke="${light}" stroke-opacity="0.55" stroke-width="1"/>` : ""}
    ${shape.facets ? `<path d="${shape.facets}" fill="none" stroke="${light}" stroke-opacity="0.7" stroke-width="1" stroke-linejoin="round"/>` : ""}
    <path d="${shape.body}" fill="url(#${id}s)" opacity="0.55"/>
    ${shape.jewel ? `<path d="M16 17.5h16l5.5 6.5L24 38.5 10.5 24Z" fill="${light}" stroke="${dark}" stroke-width="1.3" stroke-linejoin="round"/><path d="M10.5 24h27M16 17.5l4 6.5 4-6.5 4 6.5 4-6.5M20 24l4 14.5 4-14.5" fill="none" stroke="${mid}" stroke-width="0.9" stroke-linejoin="round"/><path d="M16 17.5h8l-4 6.5h-9.5Z" fill="#fff" opacity="0.7"/>` : ""}
    ${marks}${numeral}
  </svg>`;
}
