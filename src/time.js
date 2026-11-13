import { TZ } from "./constants.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function stockholmParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = bag.hour;
  if (hour === "24") hour = "00";
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday,
    key: `${bag.year}-${bag.month}-${String(bag.day).padStart(2, "0")}`,
  };
}

export function dateKey(date = new Date()) {
  const p = stockholmParts(date);
  const month = String(p.month).padStart(2, "0");
  const day = String(p.day).padStart(2, "0");
  return `${p.year}-${month}-${day}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + n));
  const y2 = utc.getUTCFullYear();
  const m2 = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(utc.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function weekdayIso(key) {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function weekdayLong(key) {
  return WEEKDAYS[weekdayIso(key) - 1];
}

export function weekStart(key) {
  return addDays(key, -(weekdayIso(key) - 1));
}

export function isWeekend(key) {
  const wd = weekdayIso(key);
  return wd === 6 || wd === 7;
}

/**
 * Epoch ms for a Stockholm civil time. Iterates so DST gaps and overlaps settle.
 * A skipped time (02:30 on the spring-forward morning) lands on the next valid instant.
 */
export function zonedTimeToUtc(key, hhmm) {
  const [y, m, d] = key.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  let utc = Date.UTC(y, m - 1, d, hh - 1, mm);
  for (let i = 0; i < 4; i += 1) {
    const p = stockholmParts(new Date(utc));
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const want = Date.UTC(y, m - 1, d, hh, mm);
    const diff = want - got;
    if (diff === 0) return utc;
    utc += diff;
  }
  return utc;
}

export function stockholmHHMM(date = new Date()) {
  const p = stockholmParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function currentSlot(date = new Date()) {
  const hour = stockholmParts(date).hour;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function formatPretty(key) {
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(utc)
    .replace(",", "");
}

export function formatWeekSpan(startKey) {
  const end = addDays(startKey, 6);
  const left = formatPretty(startKey).replace(/^[A-Za-z]{3}\s/, "");
  const right = formatPretty(end).replace(/^[A-Za-z]{3}\s/, "");
  return `${left} – ${right}`;
}

export function minuteOfDay(date = new Date()) {
  const p = stockholmParts(date);
  return p.hour * 60 + p.minute;
}
