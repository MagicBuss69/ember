import { SLOTS } from "./constants.js";
import { addDays, dateKey, weekdayIso, weekStart } from "./time.js";

export function monthKey(dateOrKey = new Date()) {
  const key = typeof dateOrKey === "string" && /^\d{4}-\d{2}/.test(dateOrKey)
    ? dateOrKey
    : dateKey(dateOrKey);
  return key.slice(0, 7);
}

export function addMonths(ym, delta) {
  const [year, month] = String(ym).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + Number(delta || 0), 1));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatMonthLabel(ym) {
  const [year, month] = String(ym).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, 15, 12));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(utc);
}

export function daySummary(state, date) {
  const day = state?.days?.[date];
  if (!day?.slots) {
    return {
      materialized: false,
      questCount: 0,
      eventCount: 0,
      totalCount: 0,
      doneCount: 0,
      hasQuests: false,
      hasEvents: false,
    };
  }
  let questCount = 0;
  let eventCount = 0;
  let doneCount = 0;
  for (const slot of SLOTS) {
    for (const item of day.slots[slot] || []) {
      if (item.isEvent) eventCount += 1;
      else questCount += 1;
      if (item.done) doneCount += 1;
    }
  }
  const totalCount = questCount + eventCount;
  return {
    materialized: true,
    questCount,
    eventCount,
    totalCount,
    doneCount,
    hasQuests: questCount > 0,
    hasEvents: eventCount > 0,
  };
}

/**
 * Build a Monday-first month grid (complete 7-day rows, Europe/Stockholm date keys).
 * Includes leading/trailing days from adjacent months so columns always align Mon–Sun.
 */
export function buildMonthGrid(ym, state, todayKey = dateKey(new Date())) {
  const [year, month] = String(ym).split("-").map(Number);
  const count = daysInMonth(year, month);
  const firstKey = `${ym}-01`;
  const lastKey = `${ym}-${String(count).padStart(2, "0")}`;
  const startKey = weekStart(firstKey);
  const endKey = addDays(lastKey, 7 - weekdayIso(lastKey));

  const cells = [];
  let cursor = startKey;
  for (let guard = 0; guard < 42; guard += 1) {
    const summary = daySummary(state, cursor);
    cells.push({
      date: cursor,
      day: Number(cursor.slice(-2)),
      inMonth: cursor.slice(0, 7) === ym,
      isToday: cursor === todayKey,
      isPast: cursor < todayKey,
      isFuture: cursor > todayKey,
      ...summary,
    });
    if (cursor === endKey) break;
    cursor = addDays(cursor, 1);
  }
  return {
    month: ym,
    label: formatMonthLabel(ym),
    startKey,
    endKey,
    cells,
  };
}
