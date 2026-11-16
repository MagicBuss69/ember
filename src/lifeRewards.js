import { dateKey } from "./time.js";

/** Real-life reward helpers: unlock minutes, one-time rewards, rotating offers. */

export const MAX_UNLOCK_MINUTES = 240;
export const CUSTOM_RETURN_DAYS = 7;
export const OFFER_PERIOD_DAYS = 3;
export const OFFER_MIN = 3;
export const OFFER_MAX = 5;
export const OFFER_PER_RESTOCK = 2;
/** A redeemed pool offer is kept out of the next few restocks. */
export const OFFER_REPEAT_GAP_PERIODS = 3;

const DAY_MS = 86_400_000;

/** Built-in one-time offers. Prices sit next to the 8–30 shard cosmetics. */
export const LIFE_OFFER_POOL = [
  { poolId: "yt20", title: "20 min YouTube", price: 15, unlockMinutes: 20 },
  { poolId: "yt45", title: "45 min YouTube binge", price: 30, unlockMinutes: 45 },
  { poolId: "tiktok15", title: "15 min TikTok scroll", price: 12, unlockMinutes: 15 },
  { poolId: "apps30", title: "30 min free phone time", price: 22, unlockMinutes: 30 },
  { poolId: "apps60", title: "1 hour phone, no questions", price: 40, unlockMinutes: 60 },
  { poolId: "game30", title: "30 min gaming", price: 20, unlockMinutes: 0 },
  { poolId: "game90", title: "Gaming night (1.5 h)", price: 45, unlockMinutes: 0 },
  { poolId: "episode", title: "One episode of a show", price: 18, unlockMinutes: 0 },
  { poolId: "movie", title: "Movie night", price: 35, unlockMinutes: 0 },
  { poolId: "snack", title: "Favorite snack", price: 14, unlockMinutes: 0 },
  { poolId: "drink", title: "Energy drink or soda", price: 12, unlockMinutes: 0 },
  { poolId: "takeout", title: "Takeout dinner pick", price: 40, unlockMinutes: 0 },
  { poolId: "bedtime", title: "Late bedtime +30 min", price: 25, unlockMinutes: 0 },
  { poolId: "sleepin", title: "Sleep in, no alarm", price: 30, unlockMinutes: 0 },
  { poolId: "skipchore", title: "Skip one chore", price: 28, unlockMinutes: 0 },
  { poolId: "music", title: "30 min music, nothing else", price: 10, unlockMinutes: 0 },
  { poolId: "dessert", title: "Dessert after dinner", price: 16, unlockMinutes: 0 },
  { poolId: "lazyday", title: "Lazy hour on the couch", price: 20, unlockMinutes: 0 },
];

export function clampUnlockMinutesValue(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_UNLOCK_MINUTES, n);
}

/** "30 min YouTube" → 30, "1h TikTok" → 60, "1.5 hours" → 90. 0 when no time is named. */
export function parseUnlockMinutes(title) {
  const text = String(title || "").toLowerCase();
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|tim|timme|timmar)\b/);
  if (hours) return clampUnlockMinutesValue(Number(hours[1].replace(",", ".")) * 60);
  const mins = text.match(/(\d{1,3})\s*(?:m|min|mins|minute|minutes|minuter)\b/);
  if (mins) return clampUnlockMinutesValue(Number(mins[1]));
  return 0;
}

export function normalizeLifeReward(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    ...raw,
    unlockMinutes: clampUnlockMinutesValue(raw.unlockMinutes),
    oneTime: raw.oneTime === true,
  };
  if (out.hiddenUntil && !Number.isFinite(Date.parse(out.hiddenUntil))) delete out.hiddenUntil;
  return out;
}

function dayIndex(now) {
  const [y, m, d] = dateKey(now).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function offerPeriod(now = new Date()) {
  return Math.floor(dayIndex(now) / OFFER_PERIOD_DAYS);
}

/** Whole days until the next restock (1..OFFER_PERIOD_DAYS). */
export function daysUntilRestock(now = new Date()) {
  const day = dayIndex(now);
  const nextStart = (Math.floor(day / OFFER_PERIOD_DAYS) + 1) * OFFER_PERIOD_DAYS;
  return nextStart - day;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureOffers(state) {
  const lo = state.lifeOffers && typeof state.lifeOffers === "object" ? state.lifeOffers : {};
  return {
    period: Number.isFinite(Number(lo.period)) ? Number(lo.period) : -1,
    offers: Array.isArray(lo.offers) ? lo.offers.filter((o) => o && o.poolId && o.id) : [],
    recent: Array.isArray(lo.recent) ? lo.recent.filter((r) => r && r.poolId) : [],
  };
}

/**
 * Date-based restock. Once per period: top up to OFFER_MIN, otherwise add up to
 * OFFER_PER_RESTOCK new ones (cap OFFER_MAX, oldest drops if full).
 * Same state + same date always gives the same offers.
 */
export function restockLifeOffers(state, now = new Date()) {
  const period = offerPeriod(now);
  const lo = ensureOffers(state);
  if (lo.period >= period && state.lifeOffers) return state;
  const next = structuredClone(state);
  let offers = [...lo.offers];
  const recent = lo.recent.filter((r) => Number(r.period) > period - OFFER_REPEAT_GAP_PERIODS);
  let add;
  if (offers.length < OFFER_MIN) add = OFFER_MIN - offers.length;
  else add = OFFER_PER_RESTOCK;
  const overflow = offers.length + add - OFFER_MAX;
  if (overflow > 0) offers = offers.slice(overflow);
  const taken = new Set(offers.map((o) => o.poolId));
  const blocked = new Set(recent.map((r) => r.poolId));
  let pool = LIFE_OFFER_POOL.filter((p) => !taken.has(p.poolId) && !blocked.has(p.poolId));
  if (pool.length < add) pool = LIFE_OFFER_POOL.filter((p) => !taken.has(p.poolId));
  const rand = seeded(period * 7919 + 17);
  const shuffled = [...pool]
    .map((p) => ({ p, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((row) => row.p);
  for (const pick of shuffled.slice(0, Math.max(0, add))) {
    offers.push({
      id: `offer-${pick.poolId}-${period}`,
      poolId: pick.poolId,
      title: pick.title,
      price: pick.price,
      unlockMinutes: pick.unlockMinutes,
      oneTime: true,
      offer: true,
      addedPeriod: period,
    });
  }
  next.lifeOffers = { period, offers, recent };
  return next;
}

/** Rewards shown on the shelf right now (custom ones on cooldown are hidden). */
export function visibleLifeRewards(state, now = new Date()) {
  const custom = (state.customRewards || [])
    .map(normalizeLifeReward)
    .filter(Boolean)
    .filter((r) => !r.hiddenUntil || Date.parse(r.hiddenUntil) <= now.getTime());
  const offers = ensureOffers(state).offers.map(normalizeLifeReward).filter(Boolean);
  return { custom, offers };
}

/** Custom one-time rewards waiting to come back, soonest first. */
export function returningLifeRewards(state, now = new Date()) {
  return (state.customRewards || [])
    .filter((r) => r?.hiddenUntil && Date.parse(r.hiddenUntil) > now.getTime())
    .map((r) => ({
      id: r.id,
      title: r.title,
      days: Math.max(1, Math.ceil((Date.parse(r.hiddenUntil) - now.getTime()) / DAY_MS)),
    }))
    .sort((a, b) => a.days - b.days);
}

/**
 * Spend shards on a custom reward or a rotating offer.
 * Returns the reward and its unlock minutes so the caller can open apps.
 */
export function redeemLifeReward(state, rewardId, now = new Date()) {
  const next = structuredClone(state);
  const customIdx = (next.customRewards || []).findIndex((r) => r.id === rewardId);
  const lo = ensureOffers(next);
  const offerIdx = lo.offers.findIndex((o) => o.id === rewardId);
  const raw = customIdx >= 0 ? next.customRewards[customIdx] : offerIdx >= 0 ? lo.offers[offerIdx] : null;
  const reward = normalizeLifeReward(raw);
  if (!reward) return { state: next, ok: false, reason: "missing" };
  if (reward.hiddenUntil && Date.parse(reward.hiddenUntil) > now.getTime()) {
    return { state: next, ok: false, reason: "cooldown" };
  }
  const price = Math.max(1, Math.round(Number(reward.price) || 0));
  if ((next.crystals || 0) < price) return { state: next, ok: false, reason: "poor" };
  next.crystals -= price;
  next.crystalLog = Array.isArray(next.crystalLog) ? next.crystalLog : [];
  next.crystalLog.unshift({ at: now.toISOString(), delta: -price, reason: `life-${reward.id}` });
  next.crystalLog = next.crystalLog.slice(0, 80);
  if (customIdx >= 0) {
    if (reward.oneTime) {
      next.customRewards[customIdx] = {
        ...next.customRewards[customIdx],
        hiddenUntil: new Date(now.getTime() + CUSTOM_RETURN_DAYS * DAY_MS).toISOString(),
      };
    }
  } else {
    lo.offers.splice(offerIdx, 1);
    lo.recent = [{ poolId: reward.poolId, period: offerPeriod(now) }, ...lo.recent].slice(0, 20);
    next.lifeOffers = lo;
  }
  return { state: next, ok: true, reward, unlockMinutes: reward.unlockMinutes };
}

/** New end of a reward unlock: extends a running one instead of restarting it. */
export function extendUnlockUntil(currentUntilIso, minutes, now = new Date()) {
  const mins = clampUnlockMinutesValue(minutes);
  const current = Date.parse(currentUntilIso || "");
  const base = Number.isFinite(current) && current > now.getTime() ? current : now.getTime();
  return new Date(base + mins * 60_000).toISOString();
}

/** Minutes left on a reward unlock, 0 once it ended. */
export function unlockMinutesLeft(untilIso, now = new Date()) {
  const until = Date.parse(untilIso || "");
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, Math.ceil((until - now.getTime()) / 60_000));
}
