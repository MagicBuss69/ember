const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date, timeZone = "Europe/Stockholm") {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = bag.hour === "24" ? 0 : Number(bag.hour);
  return {
    key: `${bag.year}-${bag.month}-${bag.day}`,
    hour,
    minute: Number(bag.minute),
    weekday: WEEKDAY[bag.weekday] || 0,
  };
}

/**
 * A reminder is due when the clock in its timezone is at the chosen minute,
 * or up to `graceMinutes` later, on an enabled weekday (or an explicit date),
 * and this occurrence has not been sent yet.
 */
export function dueReminders(schedule, now, sent = {}, graceMinutes = 2) {
  const zone = schedule?.timezone || "Europe/Stockholm";
  const parts = zonedParts(now, zone);
  const minutesNow = parts.hour * 60 + parts.minute;
  const due = [];
  for (const item of schedule?.reminders || []) {
    if (!item?.id || !item.time) continue;
    if (Array.isArray(item.dates) && item.dates.length) {
      if (!item.dates.includes(parts.key)) continue;
    } else if (!(item.days || []).includes(parts.weekday)) {
      continue;
    }
    if ((item.skipDates || []).includes(parts.key)) continue;
    const [hh, mm] = String(item.time).split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    const delta = minutesNow - (hh * 60 + mm);
    if (delta < 0 || delta >= graceMinutes) continue;
    const key = `${item.id}:${parts.key}:${item.time}`;
    if (sent[key]) continue;
    due.push({
      id: item.id,
      label: item.label || "Ember",
      time: item.time,
      date: parts.key,
      key,
    });
  }
  return due;
}
