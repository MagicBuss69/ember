const PARTICLE_COLORS = ["var(--accent)", "var(--accent-2)", "var(--crystal)", "#fff5eb"];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** Shards that fly toward the crystal meter (quest check-off). */
export function shardBurstToCrystal(fromX, fromY, reduced = false) {
  if (reduced) return;
  const target = document.querySelector("[data-shard-hud] .shard-mark img, [data-shard-hud] .currency-art, [data-crystal-meter] .crystal-gem");
  const root = document.getElementById("fx");
  if (!root || !target) {
    burstAt(fromX, fromY, reduced);
    return;
  }
  const rect = target.getBoundingClientRect();
  const tx = rect.left + rect.width / 2 - fromX;
  const ty = rect.top + rect.height / 2 - fromY;
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement("i");
    p.className = "shard";
    p.style.left = `${Math.round(fromX)}px`;
    p.style.top = `${Math.round(fromY)}px`;
    p.style.setProperty("--tx", `${tx + rand(-6, 6)}px`);
    p.style.setProperty("--ty", `${ty + rand(-6, 6)}px`);
    root.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
    setTimeout(() => p.remove(), 620);
  }
}

/** Check FX variants bought in the shop. Unknown ids fall back to the default burst. */
export const FX_STYLES = {
  nova: { count: 10, min: 28, max: 62, colors: PARTICLE_COLORS },
  embers: { count: 14, min: 20, max: 54, colors: ["#ff6a1a", "#ffb347", "#ff3d00", "#ffe0a0"] },
  frostbite: { count: 12, min: 24, max: 70, colors: ["#7ee8ff", "#c8f4ff", "#4ab8ff", "#ffffff"] },
  supernova: { count: 22, min: 40, max: 110, colors: ["#ffd24a", "#fff1c8", "#ff9a3d", "var(--accent)"] },
};

/** Lightweight GPU-only burst at a screen point (quest check-off). */
export function burstAt(x, y, reduced = false, style = "nova") {
  if (reduced) return;
  const root = document.getElementById("fx");
  if (!root) return;
  const look = FX_STYLES[style] || FX_STYLES.nova;
  const count = look.count;
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement("i");
    p.className = "particle";
    p.style.left = `${Math.round(x)}px`;
    p.style.top = `${Math.round(y)}px`;
    const angle = (Math.PI * 2 * i) / count + rand(-0.2, 0.2);
    const dist = rand(look.min, look.max);
    p.style.setProperty("--px", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--py", `${Math.sin(angle) * dist}px`);
    p.style.background = look.colors[i % look.colors.length];
    root.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
    setTimeout(() => p.remove(), 520);
  }
}

/** Wider confetti for daily complete / level moments. */
export function confettiFan(reduced = false) {
  if (reduced) return;
  const root = document.getElementById("fx");
  if (!root) return;
  const cx = window.innerWidth / 2;
  const top = window.innerHeight * 0.38;
  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement("i");
    p.className = "confetti";
    p.style.left = `${Math.round(cx + rand(-40, 40))}px`;
    p.style.top = `${Math.round(top)}px`;
    p.style.setProperty("--px", `${rand(-120, 120)}px`);
    p.style.setProperty("--py", `${rand(40, 140)}px`);
    p.style.setProperty("--rot", `${rand(-180, 180)}deg`);
    p.style.background = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
    root.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
    setTimeout(() => p.remove(), 900);
  }
}

/** Brief daily-complete banner (DOM; removed automatically). */
export function dailyCompleteBanner(reduced = false) {
  const root = document.getElementById("fx");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "daily-banner";
  el.innerHTML = "<strong>Day complete</strong><span>Every quest done. Nice.</span>";
  if (reduced) el.classList.add("is-reduced");
  root.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), reduced ? 1200 : 2800);
}