import { buildMonthGrid, daySummary, monthKey } from "../calendar.js";
import { GOOGLE_CLIENT_ID, VAPID_PUBLIC_KEY, WORKER_URL } from "../config.js";
import { SLOTS, SLOT_LABEL, SUGGESTED_EXERCISES, THEMES } from "../constants.js";
import { rankForXp, rankMeta } from "../rank.js";
import { SHOP_CATEGORIES, catalogForCategory, isOwned } from "../shop.js";
import { templateTaskCount } from "../domain.js";
import { formatLastBackupTime } from "../driveSchedule.js";
import { geminiKeyEnding } from "../gemini.js";
import { levelProgress, questXpForLevel } from "../economy.js";
import { currencyBlocked, openPenaltyQuests } from "../penalty.js";
import { esc, formatMaybe, formatNum, reasonLabel } from "../format.js";
import { currencyIcon, gemIcon, itemThumb } from "../art.js";
import { avatar, icon } from "../icons.js";
import { challengeSnapshot } from "../challenges.js";
import { buildBoard } from "../rivals.js";
import { exerciseGroups, rawGap, ringNumbers, streakCount, summarizeWeek, taskCount, totalXp, weekCompare } from "../stats.js";
import {
  addDays,
  currentSlot,
  dateKey,
  formatCountdown,
  formatPretty,
  formatWeekSpan,
  weekdayIso,
  weekdayLong,
  weekStart,
} from "../time.js";
import { coachSheetHtml, rivalChatSheetHtml } from "./coachSheet.js";
import { crystalMeterHtml, emptyState, levelBar, ringHtml, slotSection, weekChartHtml } from "./bits.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function slotOpts(state, ui, extra) {
  return {
    doneSlotsOpen: state.settings?.doneSlotsOpen || {},
    collapsingId: ui.collapsingId || null,
    ...extra,
  };
}

function gapNote(gap) {
  if (!gap.length) return "";
  const when = gap.length === 1 ? formatPretty(gap[0]) : `${gap.length} days`;
  return `<p class="note warn">${esc(when)} missed — streak broken. Finish every must-do quest on Today.</p>`;
}

function sortSlotItems(items) {
  const penalties = items.filter((task) => task.penaltyTag);
  const rest = items.filter((task) => !task.penaltyTag);
  return [...penalties, ...rest];
}

function challengeCard(state, now) {
  if (!state.settings?.challengesOn) return "";
  const snap = challengeSnapshot(state, now);
  const current = snap.current;
  if (!current) {
  const next = snap.nextRollAt ? new Date(snap.nextRollAt) : null;
    const eta = next && next > now ? `Next roll around ${next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for the next roll";
    return `<article class="challenge-card challenge-card-idle" data-challenge-card>
      <p class="challenge-kicker">Hourly challenge</p>
      <p class="muted">${esc(eta)}${snap.locked ? " · Finish every quest (not events) to unlock." : snap.quiet ? " · Quiet hours." : ""}</p>
    </article>`;
  }
  const unit = current.isSeconds ? "sec" : "reps";
  return `<article class="challenge-card challenge-card-active" data-challenge-card>
    <p class="challenge-kicker">Challenge · ${esc(current.label)}</p>
    <p class="challenge-big"><span class="num">${current.reps}</span> ${esc(unit)}</p>
    <p class="challenge-timer">Time left <strong id="challenge-countdown">${formatCountdown(snap.msRemaining)}</strong></p>
    <button type="button" class="primary" data-action="confirm-challenge">Done (honor system)</button>
  </article>`;
}

function mustDoBanner(state, today) {
  if (!currencyBlocked(state, today)) return "";
  const open = openPenaltyQuests(state, today);
  const list = open.map(({ task }) => `<li>${esc(task.title)}</li>`).join("");
  return `<div class="must-do-banner" role="status">
    <p class="must-do-kicker">Currency frozen</p>
    <p>Clear every must-do penalty before you earn shards from quests again.</p>
    <ul class="must-do-list">${list}</ul>
  </div>`;
}

export function viewToday(state, ui, now) {
  const today = dateKey(now);
  const date = ui.lookDate && ui.lookDate <= today ? ui.lookDate : today;
  const lookingToday = date === today;
  const day = state.days[date];
  const ring = ringNumbers(state, date);
  const streak = streakCount(state, today);
  const gap = lookingToday ? rawGap(state, today) : [];
  const nowSlot = currentSlot(now);
  const xp = totalXp(state);
  const progress = levelProgress(xp);
  const rank = rankForXp(xp);
  const skin = state.settings?.crystalSkin || "default";
  const questXp = questXpForLevel(progress.level);
  let body = "";
  if (!day) {
    body = emptyState({
      title: "Nothing on this day",
      body: date < state.startedOn
        ? `Ember started ${formatPretty(state.startedOn)}. Earlier days stay empty.`
        : "This day was never planned.",
      actions: `<button type="button" class="primary" data-action="use-template-day" data-date="${date}">Use the template</button>`,
    });
  } else {
    const total = SLOTS.reduce((sum, slot) => sum + (day.slots[slot]?.length || 0), 0);
    if (!total) {
      body = emptyState({
        title: "No quests on this day",
        body: "Add one, or copy this weekday from the template.",
        actions: `
          <button type="button" class="primary" data-action="add-task" data-date="${date}" data-slot="${nowSlot}">Add a quest</button>
          <button type="button" class="ghost" data-action="use-template-day" data-date="${date}">Use the template</button>`,
      });
    } else {
      body = SLOTS.map((slot) =>
        slotSection(
          slotOpts(state, ui, {
            slot,
            items: sortSlotItems(day.slots[slot] || []),
            nowSlot: lookingToday ? nowSlot : null,
            date,
            template: false,
            justDoneId: ui.justDoneId,
            movable: true,
            reordering: true,
            questXp,
          }),
        ),
      ).join("");
    }
  }
  const hint = lookingToday && !state.settings.dismissedHint
    ? `<div class="hint"><p>Starter week, picked for a school day in Sweden. Change or drag any quest. It only lives on this phone.</p><button type="button" data-action="dismiss-hint">Got it</button></div>`
    : "";
  return `
    <section class="today">
      ${lookingToday ? mustDoBanner(state, today) : ""}
      ${lookingToday ? challengeCard(state, now) : ""}
      <div id="today-board-expanded" class="today-board-expanded">
        <div class="sticky-board">
          <div class="sticky-board-head">
            ${ringHtml(ring.done, ring.total, ui.ringPulse)}
            <div class="date-nav date-nav-sticky">
              <div class="date-nav-title-row">
                <button type="button" class="icon-btn icon-btn-tight" data-action="shift-day" data-dir="-1" aria-label="Previous day">${icon("chevL")}</button>
                <h1 class="date-nav-title">${lookingToday ? "Today" : esc(weekdayLong(date))}</h1>
                <button type="button" class="icon-btn icon-btn-tight" data-action="shift-day" data-dir="1" aria-label="Next day" ${lookingToday ? "disabled" : ""}>${icon("chevR")}</button>
              </div>
              <p class="date-nav-sub">${esc(formatPretty(date))}</p>
            </div>
          </div>
          ${crystalMeterHtml({
            progress,
            rank,
            stress: state.crystalStress,
            pulse: ui.barPulse,
            skin,
            compact: false,
          })}
          ${levelBar(progress, xp, ui.barPulse)}
          <p class="streak-line ${streak >= 7 ? "heat-3" : streak >= 3 ? "heat-2" : streak >= 1 ? "heat-1" : ""}">${icon("flame")} ${streak ? `${streak}-day streak` : "No streak yet"}</p>
        </div>
      </div>
      ${!lookingToday ? `<button type="button" class="ghost slim" data-action="jump-today">Back to today</button>` : ""}
      ${gapNote(gap)}
      ${hint}
      ${body}
    </section>`;
}

export function viewWeek(state, ui, now) {
  const today = dateKey(now);
  const start = weekStart(today);
  const mode = ui.weekMode === "template"
    ? "template"
    : ui.weekMode === "calendar"
      ? "calendar"
      : "week";
  const tabs = `
    <div class="segment" role="tablist">
      <button type="button" data-action="week-mode" data-mode="week" aria-pressed="${mode === "week"}">This week</button>
      <button type="button" data-action="week-mode" data-mode="calendar" aria-pressed="${mode === "calendar"}">Calendar</button>
      <button type="button" data-action="week-mode" data-mode="template" aria-pressed="${mode === "template"}">Template</button>
    </div>`;

  if (mode === "calendar") {
    return `
      <section>
        <h1 class="page-title">Week</h1>
        ${tabs}
        ${calendarBody(state, ui, now, today)}
      </section>`;
  }

  let selected = ui.selectedDate || today;
  if (selected < start || selected > addDays(start, 6)) selected = today;
  const weekday = String(ui.selectedWeekday || weekdayIso(selected));
  const chips = mode === "week"
    ? Array.from({ length: 7 }, (_, i) => {
        const date = addDays(start, i);
        const day = state.days[date];
        const hasDone = day && SLOTS.some((slot) => (day.slots[slot] || []).some((task) => task.done));
        const hasEvent = day && SLOTS.some((slot) => (day.slots[slot] || []).some((task) => task.isEvent));
        const on = date === selected;
        const dots = `${hasEvent ? `<i class="dot is-event"></i>` : ""}${hasDone ? `<i class="dot"></i>` : ""}`;
        return `<button type="button" class="day-chip" data-action="select-date" data-date="${date}" aria-pressed="${on}">
          <span class="dow">${DOW[i]}</span><span class="dom num">${Number(date.slice(-2))}</span>${dots ? `<span class="chip-dots">${dots}</span>` : ""}
        </button>`;
      }).join("")
    : WEEKDAYS.map((name, i) => {
        const id = String(i + 1);
        return `<button type="button" class="day-chip" data-action="select-weekday" data-weekday="${id}" aria-pressed="${id === weekday}">
          <span class="dow">${name.slice(0, 3)}</span><span class="dom num">${id}</span>
        </button>`;
      }).join("");
  const sections = mode === "week"
    ? SLOTS.map((slot) =>
        slotSection(
          slotOpts(state, ui, {
            slot,
            items: state.days[selected]?.slots?.[slot] || [],
            nowSlot: selected === today ? currentSlot(now) : null,
            date: selected,
            template: false,
            justDoneId: ui.justDoneId,
            movable: true,
            reordering: true,
            canToggle: selected <= today,
          }),
        ),
      ).join("")
    : SLOTS.map((slot) =>
        slotSection(
          slotOpts(state, ui, {
            slot,
            items: state.template[weekday]?.[slot] || [],
            date: "",
            weekday,
            template: true,
            justDoneId: null,
            movable: true,
            reordering: true,
          }),
        ),
      ).join("");
  const actions = mode === "week"
    ? `<div class="stack-actions">
        <button type="button" class="primary" data-action="open-generate">Generate this week</button>
        <button type="button" class="ghost" data-action="open-copy-day" data-kind="week" data-date="${selected}">Copy to other days</button>
        <button type="button" class="ghost" data-action="save-weekday" data-date="${selected}">Save ${esc(weekdayLong(selected))} to the template</button>
        <button type="button" class="ghost" data-action="apply-template">Fill open days from the template</button>
      </div>`
    : `<div class="stack-actions">
        <button type="button" class="ghost" data-action="open-copy-day" data-kind="template" data-weekday="${weekday}">Copy to other days</button>
      </div>
      <p class="lede">This repeats every week. It fills days you haven't started. Finished days stay as they are.</p>`;
  return `
    <section>
      <h1 class="page-title">Week</h1>
      ${tabs}
      <p class="lede">${mode === "week" ? esc(formatWeekSpan(start)) : "Monday to Sunday"}</p>
      <div class="day-strip">${chips}</div>
      ${sections}
      ${actions}
    </section>`;
}

function calendarBody(state, ui, now, today) {
  const calDate = /^\d{4}-\d{2}-\d{2}$/.test(ui.calDate || "") ? ui.calDate : today;
  const ym = /^\d{4}-\d{2}$/.test(ui.calMonth || "") ? ui.calMonth : monthKey(calDate);
  const grid = buildMonthGrid(ym, state, today);
  const isCurrentMonth = ym === monthKey(today);
  const dowRow = DOW.map((letter) => `<span>${letter}</span>`).join("");
  const cells = grid.cells
    .map((cell) => {
      const selected = cell.date === calDate;
      const cls = [
        "cal-cell",
        cell.inMonth ? "" : "is-outside",
        cell.isToday ? "is-today" : "",
        cell.hasEvents ? "has-event" : "",
      ].filter(Boolean).join(" ");
      const dots = `${cell.hasEvents ? `<i class="cal-dot is-event"></i>` : ""}${cell.hasQuests ? `<i class="cal-dot ${cell.doneCount === cell.totalCount && cell.totalCount > 0 ? "is-done" : ""}"></i>` : ""}`;
      return `<button type="button" class="${cls}" data-action="cal-select-date" data-date="${cell.date}" aria-pressed="${selected}" aria-label="${esc(formatPretty(cell.date))}${cell.hasEvents ? ", has event" : ""}${cell.hasQuests ? `, ${cell.questCount} quests` : ""}">
        <span class="cal-num num">${cell.day}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
    })
    .join("");

  const isPast = calDate < today;
  const isToday = calDate === today;
  const summary = daySummary(state, calDate);
  const day = state.days[calDate];
  const nowSlot = currentSlot(now);
  const tagText = isToday ? "Today" : isPast ? "Past · view only" : "Upcoming";

  let dayBody = "";
  if (isPast) {
    if (!day || summary.totalCount === 0) {
      dayBody = `<p class="slot-empty">Nothing was scheduled on ${esc(formatPretty(calDate))}.</p>`;
    } else {
      dayBody = SLOTS.map((slot) => {
        const items = day.slots[slot] || [];
        if (!items.length) return "";
        return slotSection(
          slotOpts(state, ui, {
            slot,
            items,
            nowSlot: null,
            date: calDate,
            template: false,
            justDoneId: null,
            readOnly: true,
          }),
        );
      }).join("");
    }
  } else {
    const canPrefill = !day || summary.questCount === 0;
    const prefillBtn = canPrefill
      ? `<button type="button" class="ghost" data-action="use-template-day" data-date="${calDate}">Use ${esc(weekdayLong(calDate))} template</button>`
      : "";
    const slotsHtml = SLOTS.map((slot) =>
      slotSection(
        slotOpts(state, ui, {
          slot,
          items: day?.slots?.[slot] || [],
          nowSlot: isToday ? nowSlot : null,
          date: calDate,
          template: false,
          justDoneId: ui.justDoneId,
          movable: true,
          reordering: true,
          canToggle: isToday,
        }),
      ),
    ).join("");
    dayBody = `
      <div class="cal-quick">
        <button type="button" class="primary" data-action="add-event" data-date="${calDate}" data-slot="${isToday ? nowSlot : "morning"}">${icon("plus")} Add an event</button>
        ${prefillBtn}
      </div>
      ${slotsHtml}`;
  }

  return `
    <div class="cal-bar">
      <button type="button" class="icon-btn" data-action="shift-month" data-dir="-1" aria-label="Previous month">${icon("chevL")}</button>
      <div class="cal-month-title">
        <strong>${esc(grid.label)}</strong>
        ${!isCurrentMonth || calDate !== today ? `<button type="button" class="cal-jump" data-action="cal-today">Today</button>` : ""}
      </div>
      <button type="button" class="icon-btn" data-action="shift-month" data-dir="1" aria-label="Next month">${icon("chevR")}</button>
    </div>
    <div class="cal-dow" aria-hidden="true">${dowRow}</div>
    <div class="cal-grid" role="grid" aria-label="${esc(grid.label)}">${cells}</div>
    <div class="cal-day-head">
      <div>
        <h2>${esc(formatPretty(calDate))}</h2>
        <span class="cal-tag ${isPast ? "is-past" : isToday ? "is-now" : ""}">${tagText}</span>
      </div>
    </div>
    ${dayBody}`;
}

export function viewTrain(state, ui, now) {
  const today = dateKey(now);
  const summary = summarizeWeek(state, today);
  const max = Math.max(1, ...summary.bars);
  const groups = exerciseGroups(state);
  const bars = summary.bars
    .map((count, i) => {
      const h = count / max;
      return `<div class="bar-col"><span class="${count ? "" : "is-zero"}" style="--h:${h.toFixed(3)}"></span><small>${DOW[i]}</small></div>`;
    })
    .join("");
  if (ui.exercise) {
    const group = groups.find((item) => item.key === ui.exercise);
    if (!group) ui.exercise = null;
  }
  if (ui.exercise) {
    const group = groups.find((item) => item.key === ui.exercise);
    return `
      <section>
        <button type="button" class="back" data-action="close-exercise">${icon("back")} Exercises</button>
        <h1 class="page-title">${esc(group.name)}</h1>
        <p class="lede">${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}${group.best ? ` · best ${esc(group.best.label)}` : ""}</p>
        ${group.sessions
          .map((session) => {
            const detail = session.kind === "cardio"
              ? `<p>${formatMaybe(session.distanceKm)} km · ${formatMaybe(session.durationMin)} min</p>`
              : `<ul class="sets">${(session.sets || [])
                  .map((set, index) => `<li><span>Set ${index + 1}</span><span class="num">${set.reps} × ${formatMaybe(set.weightKg)} kg</span></li>`)
                  .join("")}</ul>`;
            return `<article class="session">
              <header><strong>${esc(formatPretty(session.date))}</strong>
                <button type="button" class="icon-btn" data-action="delete-workout" data-id="${esc(session.id)}" aria-label="Delete session">${icon("trash")}</button>
              </header>
              ${detail}
              ${session.notes ? `<p class="quest-meta">${esc(session.notes)}</p>` : ""}
            </article>`;
          })
          .join("")}
      </section>`;
  }
  const list = groups.length
    ? groups
        .map((group) => `<button type="button" class="ex-row" data-action="open-exercise" data-name="${esc(group.key)}">
            <span><strong>${esc(group.name)}</strong><small>${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}${group.best ? ` · best ${esc(group.best.label)}` : ""}</small></span>
            ${icon("chevR")}
          </button>`)
        .join("")
    : emptyState({
        title: "No sessions yet",
        body: "Log a lift or a run. It lands in this week’s volume and pays 40 XP.",
        actions: `<button type="button" class="primary" data-action="open-workout">Log a session</button>`,
      });
  return `
    <section>
      <h1 class="page-title">Train</h1>
      <p class="lede">${esc(formatWeekSpan(summary.start))}</p>
      <div class="stat-grid">
        <div class="stat"><strong class="num">${summary.sessions}</strong><span>sessions</span></div>
        <div class="stat"><strong class="num">${formatMaybe(summary.volume)}</strong><span>kg volume</span></div>
        <div class="stat"><strong class="num">${formatMaybe(summary.km)}</strong><span>kilometres</span></div>
        <div class="stat"><strong class="num">${formatMaybe(summary.minutes)}</strong><span>minutes</span></div>
      </div>
      <div class="bars" aria-hidden="true">${bars}</div>
      ${groups.length ? `<button type="button" class="primary" data-action="open-workout">Log a session</button>` : ""}
      <h2 class="section-title">Exercises</h2>
      <div class="list">${list}</div>
    </section>`;
}

export function viewRivals(state, ui, now) {
  const today = dateKey(now);
  const board = buildBoard(state, now);
  const compare = weekCompare(state, today);
  const streak = streakCount(state, today);
  const delta = board.same.delta;
  const deltaText = delta > 0 ? `+${formatNum(delta)}` : delta < 0 ? `−${formatNum(-delta)}` : "0";
  const rows = board.board
    .map((row) => `<article class="board-row ${row.you ? "you" : ""}"${row.you ? "" : ` data-action="open-rival" data-rival="${esc(row.id)}" role="button" tabindex="0"`}>
        <span class="rank num">${row.rank}</span>
        ${avatar(row.you ? "you" : row.id)}
        <span class="who"><strong>${esc(row.name)}</strong><small>${esc(row.city)} · ${esc(row.status)}</small></span>
        <span class="xp num">${formatNum(row.weekXp)}</span>
      </article>`)
    .join("");
  const feed = board.feed.length
    ? board.feed
        .map((item) => `<article class="feed-item">${avatar(item.rivalId)}<div><p>${esc(item.text)}</p><small>${esc(item.ago)}</small></div></article>`)
        .join("")
    : `<p class="slot-empty">Quiet so far. The day is still early.</p>`;
  return `
    <section class="rivals">
      <h1 class="page-title">Rivals</h1>
      <p class="lede">The one to beat is you, a week ago.</p>
      <div class="rivals-grid">
        <article class="hero-card tone-${board.same.tone}">
          <p class="kicker">${esc(board.same.kicker)}</p>
          ${board.same.mode === "score" ? `<p class="delta">${deltaText}<small> XP</small></p>` : ""}
          <h2>${esc(board.same.headline)}</h2>
          <p class="detail">${esc(board.same.detail)}</p>
          <div class="race">
            <div class="race-row"><span>You today</span><span class="num">${formatNum(board.same.todayXp)}</span></div>
            <div class="track race-live" style="--you-pct:${Math.max(0, Math.min(1, board.same.youPct)).toFixed(4)}">
              <span style="transform:scaleX(${Math.max(0, Math.min(1, board.same.youPct)).toFixed(4)})"></span>
              <i class="race-pin you" style="left:calc(${Math.max(0, Math.min(1, board.same.youPct)).toFixed(4)} * 100%)" aria-hidden="true"></i>
            </div>
            <div class="race-row"><span>Last ${esc(board.same.weekdayName)}</span><span class="num">${formatNum(board.same.thenXp)}</span></div>
            <div class="track ghost race-ghost" style="--ghost-pct:${Math.max(0, Math.min(1, board.same.ghostPct)).toFixed(4)}">
              <span style="transform:scaleX(${Math.max(0, Math.min(1, board.same.ghostPct)).toFixed(4)})"></span>
              <i class="race-pin ghost" style="left:calc(${Math.max(0, Math.min(1, board.same.ghostPct)).toFixed(4)} * 100%)" aria-hidden="true"></i>
            </div>
          </div>
        </article>
        <article class="card tone-${board.pace.tone}">
          <h2>${esc(board.pace.headline)}</h2>
          <p>${esc(board.pace.detail)}</p>
        </article>
        <article class="card tone-${board.best.tone}">
          <h2>${esc(board.best.headline)}</h2>
          <p>${esc(board.best.detail)}</p>
        </article>
        <article class="card tone-${streak >= 3 ? "ahead" : "open"}">
          <h2>${streak ? `${streak}-day streak` : "Start a streak"}</h2>
          <p>Finish at least one quest every day. Miss a day and the System assigns a penalty.</p>
        </article>
      </div>
      ${weekChartHtml(compare)}
      <h2 class="section-title">This week</h2>
      <div class="board">${rows}</div>
      <h2 class="section-title">Activity</h2>
      <div class="feed">${feed}</div>
      <p class="footnote">Leo, Maja, Noah, and Amina are simulated on this phone. They are not accounts, and no one else can see this.</p>
    </section>`;
}

function shopSection(state, ui) {
  const activeCat = ui.shopCat || "themes";
  const tabs = SHOP_CATEGORIES.map(
    (cat) => `<button type="button" class="ghost tiny ${activeCat === cat.id ? "is-on" : ""}" data-action="shop-cat" data-cat="${cat.id}">${esc(cat.label)}</button>`,
  ).join("");
  const items = catalogForCategory(activeCat).map((item) => {
    const owned = isOwned(state, item);
    const afford = state.crystals >= item.price;
    const action = owned
      ? equipButtonForItem(state, item)
      : `<button type="button" class="ghost tiny shop-price-btn" data-action="ask-buy-item" data-item="${item.id}" ${afford ? "" : "disabled"}><span class="num">${item.price}</span> ${currencyIcon({ size: 16 })}</button>`;
    return `<article class="theme shop-item">
      ${itemThumb(item.id, { alt: item.name })}
      <span><strong>${esc(item.name)}</strong><small>${esc(item.blurb)}</small></span>
      ${action}
    </article>`;
  }).join("");
  const life = (state.customRewards || [])
    .map(
      (reward) => `<article class="theme shop-item life-reward-item">
      ${itemThumb("life-reward", { alt: reward.title })}
      <span class="life-reward-copy"><strong>${esc(reward.title)}</strong><small>${reward.price} shards to redeem</small></span>
      <div class="shop-item-actions">
        <button type="button" class="ghost tiny shop-price-btn" data-action="redeem-life" data-reward="${reward.id}" ${state.crystals >= reward.price ? "" : "disabled"}">Redeem <span class="num">${reward.price}</span> ${currencyIcon({ size: 16 })}</button>
        <button type="button" class="icon-btn danger-ghost" data-action="ask-remove-life-reward" data-reward="${reward.id}" aria-label="Remove ${esc(reward.title)}">${icon("trash")}</button>
      </div>
    </article>`,
    )
    .join("");
  return `
    <h2 class="section-title" id="shop">Shop</h2>
    <p class="lede">Spend shards on cosmetics, FX, sounds, and things you actually want IRL.</p>
    <div class="shop-tabs">${tabs}</div>
  ${activeCat === "life" ? life || `<p class="slot-empty">No real-life rewards yet.</p>` : items || `<p class="slot-empty">Nothing here yet.</p>`}
    ${activeCat === "life" ? `<button type="button" class="ghost slim" data-action="add-life-reward">+ Add life reward token</button>` : ""}`;
}

function equipButtonForItem(state, item) {
  if (item.kind === "theme") {
    const active = state.settings.theme === item.themeId;
    return `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-theme" data-theme="${item.themeId}">${active ? "Using" : "Use"}</button>`;
  }
  if (item.kind === "skin") {
    const active = state.settings.crystalSkin === item.skinId;
    return `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-cosmetic" data-kind="skin" data-value="${item.skinId}">${active ? "On" : "Equip"}</button>`;
  }
  if (item.kind === "title") {
    const active = state.settings.equippedTitle === item.titleId;
    return `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-cosmetic" data-kind="title" data-value="${item.titleId}">${active ? "On" : "Equip"}</button>`;
  }
  if (item.kind === "fx") {
    const active = state.settings.checkFx === item.fxId;
    return `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-cosmetic" data-kind="fx" data-value="${item.fxId}">${active ? "On" : "Equip"}</button>`;
  }
  if (item.kind === "soundPack") {
    const active = state.settings.soundPack === item.soundPackId;
    return `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-cosmetic" data-kind="soundPack" data-value="${item.soundPackId}">${active ? "On" : "Equip"}</button>`;
  }
  return `<span class="owned-tag">Owned</span>`;
}

export function viewYou(state, ui) {
  const xp = totalXp(state);
  const progress = levelProgress(xp);
  const meta = rankMeta(progress.level);
  const streak = streakCount(state, dateKey(new Date()));
  const title = state.settings.equippedTitle ? ` · ${state.settings.equippedTitle}` : "";
  const log = state.crystalLog.length
    ? `<ul class="log">${state.crystalLog
        .slice(0, 8)
        .map((entry) => `<li><span>${esc(reasonLabel(entry.reason))}</span><span class="num ${entry.delta < 0 ? "neg" : ""}">${entry.delta > 0 ? "+" : ""}${entry.delta}</span></li>`)
        .join("")}</ul>`
    : `<p class="slot-empty">Shards you earn and spend show up here.</p>`;
  const badges = (state.ownedBadges || []).map((id) => `<span class="badge-pill">${esc(id)}</span>`).join("");
  return `
    <section class="you-page">
      <h1 class="page-title">You</h1>
      <div class="you-hero system-glass">
        ${crystalMeterHtml({
          progress,
          rank: meta.rank,
          stress: state.crystalStress,
          pulse: ui.barPulse,
          skin: state.settings?.crystalSkin,
        })}
        <p class="kicker">${esc(meta.label)}${esc(title)}</p>
        <h2>${progress.maxed ? "The top of the scale." : `${formatNum(progress.span - progress.into)} XP to level ${progress.level + 1}`}</h2>
        ${levelBar(progress, xp, ui.barPulse)}
      </div>
      <div class="stat-grid">
        <div class="stat"><strong class="num">${streak}</strong><span>day streak</span></div>
        <div class="stat"><strong class="num">${state.longest || 0}</strong><span>longest</span></div>
        <div class="stat"><strong class="num">${formatNum(state.crystals)}</strong><span>shards</span></div>
        <div class="stat"><strong class="display">${meta.rank}</strong><span>rank</span></div>
      </div>
      ${badges ? `<div class="badge-row">${badges}</div>` : ""}
      ${shopSection(state, ui)}
      <h2 class="section-title">Shard log</h2>
      ${log}
      <h2 class="section-title">Goals</h2>
      <label class="field">
        <span>What this week is for</span>
        <textarea id="goals" rows="4" data-bind="goals" data-commit="settings" maxlength="2000">${esc(state.settings.goals)}</textarea>
      </label>
      <p class="footnote">Ember v2 · Europe/Stockholm · on this phone only</p>
    </section>`;
}

export function viewSettings(state, ui) {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const perm = ui.notifyState || "default";
  const permLabel = perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Not available" : "Not asked yet";
  const periodic = ui.periodic === "native"
    ? "Reminders are scheduled on this phone and can fire while Ember is closed."
    : ui.periodic === "registered"
      ? "A background check is registered. Chrome still picks the hour."
      : ui.periodic === "unsupported"
        ? "This browser has no background check."
        : "Background check starts after you install Ember and allow notifications.";
  const vol = Math.round((Number(state.settings.soundVolume) || 0.8) * 100);
  const themePick = THEMES.filter((t) => state.ownedThemes.includes(t.id))
    .map((theme) => {
      const active = state.settings.theme === theme.id;
      return `<button type="button" class="theme-art-btn ${active ? "is-on" : ""}" data-action="equip-theme" data-theme="${theme.id}" aria-pressed="${active ? "true" : "false"}">
        ${itemThumb(`theme-${theme.id}`, { alt: theme.name, size: 52 })}
        <span>${esc(theme.name)}</span>
      </button>`;
    })
    .join("");
  return `
    <section>
      <h1 class="page-title">Settings</h1>
      <h2 class="section-title">Theme</h2>
      <p class="lede">Frost is the flagship System look. Each theme shifts the whole UI, not just the accent.</p>
      <div class="theme-pick theme-pick-art">${themePick}</div>
      <h2 class="section-title">Sound</h2>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.sound ? "true" : "false"}" data-action="toggle-setting" data-key="sound"><span>Sounds</span><i></i></button>
      <label class="field">
        <span>Volume</span>
        <input type="range" min="0" max="100" value="${vol}" data-action="sound-volume" />
        <span class="num">${vol}%</span>
      </label>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.haptics ? "true" : "false"}" data-action="toggle-setting" data-key="haptics"><span>Vibration</span><i></i></button>
      <h2 class="section-title">Challenges</h2>
      <p class="lede">Hourly movement rolls with 10 minutes to confirm. Quiet hours pause rolls; open challenges cancel without punishment.</p>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.challengesOn !== false ? "true" : "false"}" data-action="toggle-setting" data-key="challengesOn"><span>Hourly challenges</span><i></i></button>
      <h3 class="subsection-title">School quiet (Mon–Fri)</h3>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.quietSchool?.on !== false ? "true" : "false"}" data-action="toggle-setting" data-key="quietSchool" data-field="on"><span>School quiet hours</span><i></i></button>
      <div class="row-fields">
        <label class="field compact"><span>From</span><input type="time" value="${esc(state.settings.quietSchool?.start || "06:35")}" data-quiet-time data-parent="quietSchool" data-field="start" /></label>
        <label class="field compact"><span>Until</span><input type="time" value="${esc(state.settings.quietSchool?.end || "16:00")}" data-quiet-time data-parent="quietSchool" data-field="end" /></label>
      </div>
      <h3 class="subsection-title">Night quiet</h3>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.quietNight?.on !== false ? "true" : "false"}" data-action="toggle-setting" data-key="quietNight" data-field="on"><span>Night quiet hours</span><i></i></button>
      <div class="row-fields">
        <label class="field compact"><span>From</span><input type="time" value="${esc(state.settings.quietNight?.start || "22:00")}" data-quiet-time data-parent="quietNight" data-field="start" /></label>
        <label class="field compact"><span>Until</span><input type="time" value="${esc(state.settings.quietNight?.end || "06:20")}" data-quiet-time data-parent="quietNight" data-field="end" /></label>
      </div>
      <h2 class="section-title">Android blocker</h2>
      <p class="lede">Opening a blocked app starts a push-up set on the front camera. Hit your max and that app stays open for a few minutes. The old “locked until every quest is done” mode is off unless you turn it on.</p>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.blockMode === "quests" ? "true" : "false"}" data-action="toggle-block-mode"><span>Block until quests are done</span><i></i></button>
      ${state.settings.blockMode === "quests" ? "" : `<div class="row-fields">
        <label class="field compact"><span>Unlock minutes</span><input type="number" min="1" max="180" inputmode="numeric" data-unlock-minutes value="${esc(state.settings.unlockMinutes || 15)}" /></label>
        <label class="field compact"><span>Max push-ups</span><input type="number" min="1" max="300" inputmode="numeric" data-pushup-max value="${esc(state.settings.pushupMax || 10)}" /></label>
      </div>
      <button type="button" class="ghost" data-action="test-pushups">Test this max</button>`}
      <button type="button" class="ghost" data-action="open-accessibility">Open accessibility settings</button>
      <button type="button" class="ghost" data-action="pick-blocked-apps">Choose blocked apps</button>
      <p class="footnote">Sideloaded APK: enable Accessibility for Ember. On Android 13+, App info → ⋮ → Allow restricted settings. Blocked: ${esc((state.settings.blockedPackages || []).join(", ") || "YouTube, TikTok (if installed)")}</p>
      <h2 class="section-title">Gemini</h2>
      <p class="lede">Optional. Ember works with no key. The key stays on this phone.</p>
      ${geminiCard(state, ui)}
      <p class="lede"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a free key in Google AI Studio</a></p>
      <h2 class="section-title">Reminders</h2>
      ${reminderBlock(state, ui, permLabel, periodic)}
      <h2 class="section-title">Backup</h2>
      <div class="stack-actions">
        <button type="button" class="ghost" data-action="export">${icon("download")} Export backup</button>
        <button type="button" class="ghost" data-action="import">${icon("upload")} Import backup</button>
      </div>
      ${driveSection(state, ui)}
      <h2 class="section-title">Install</h2>
      ${installBlock(standalone, ui)}
      <button type="button" class="danger" data-action="ask-reset">Erase everything on this phone</button>
    </section>`;
}

export function penaltyHtml(ui) {
  const report = ui.penaltyWindow;
  if (!report) return "";
  const days = (report.dates || []).map((d) => formatPretty(d)).join(", ");
  const streakLost = Number(report.streakLost) || 0;
  const headline = streakLost > 0 ? "Streak broken" : "The System has recorded a failure.";
  const streakLine =
    streakLost > 0
      ? `<p class="num">${streakLost}-day streak lost · −${report.streakXpLost || 0} XP from the break</p>`
      : `<p class="num">Streak reset</p>`;
  const mustDoParts = [];
  if (report.missMustDoAdded) mustDoParts.push(`${report.missMustDoAdded} for missed quests`);
  if (report.streakMustDoAdded) mustDoParts.push(`${report.streakMustDoAdded} for the lost streak`);
  const mustDoDetail = mustDoParts.length ? ` (${mustDoParts.join(", ")})` : "";
  return `
    <div class="penalty-window" role="dialog" aria-modal="true">
      <div class="penalty-card system-glass">
        <p class="penalty-tag">PENALTY</p>
        <h2>${headline}</h2>
        <p>Missed: ${esc(days || "recent days")}</p>
        ${streakLine}
        <p class="num">−${report.xpLost || 0} XP total</p>
        <p>${report.mustDoAdded || 1} must-do quest${(report.mustDoAdded || 1) === 1 ? "" : "s"} on Today${esc(mustDoDetail)}.</p>
        <p class="muted">Shard earnings stay frozen until every must-do is cleared.</p>
        <button type="button" class="primary" data-action="dismiss-penalty">Accept</button>
      </div>
    </div>`;
}

function geminiStatusLine(state) {
  const ending = geminiKeyEnding(state.settings.geminiApiKey);
  const tail = ending ? ` · ending …${ending}` : "";
  if (state.settings.geminiKeyStatus === "ok") return `Saved ✓ · Key works${tail}`;
  if (state.settings.geminiKeyStatus === "offline") return `Saved ✓ · Not checked, you were offline${tail}`;
  return `Saved${tail}`;
}

function geminiCard(state, ui) {
  const saved = String(state.settings.geminiApiKey || "");
  const editing = !saved || ui.editingGemini;
  if (!editing) {
    return `
      <article class="gemini-card">
        <p class="saved-line">${esc(geminiStatusLine(state))}</p>
        <div class="split">
          <button type="button" class="ghost" data-action="replace-gemini">Replace</button>
          <button type="button" class="danger" data-action="ask-remove-gemini">Remove</button>
        </div>
      </article>`;
  }
  const draft = ui.geminiDraft ?? "";
  const dirty = draft.trim().length > 0 && draft.trim() !== saved;
  return `
    <article class="gemini-card">
      ${ui.geminiError ? `<p class="form-error">${esc(ui.geminiError)}</p>` : ""}
      <label class="field">
        <span>API key</span>
        <span class="key-row">
          <input id="gemini-key" type="${ui.revealKey ? "text" : "password"}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a free key" value="${esc(draft)}" />
          <button type="button" class="ghost tiny" data-action="toggle-reveal">${ui.revealKey ? "Hide" : "Show"}</button>
        </span>
      </label>
      <button type="button" class="primary" data-action="save-gemini" ${dirty && !ui.geminiBusy ? "" : "disabled"}>${ui.geminiBusy ? "Checking…" : "Save"}</button>
    </article>`;
}

function reminderBlock(state, ui, permLabel, periodic) {
  const pushReady = Boolean(String(WORKER_URL || "").trim() && String(VAPID_PUBLIC_KEY || "").trim());
  const native = ui.periodic === "native";
  const blurb = native
    ? "Today's quests are scheduled on this phone. They can fire even when Ember is closed."
    : "While Ember is open, a quest notifies you at its time. If the app was closed, you get it the next time you open Ember, unless closed-app reminders are turned on below.";
  const local = `<p class="lede">Status: ${esc(permLabel)}. ${esc(periodic)}</p>
    <p class="lede">${blurb}</p>
    ${ui.notifyState === "granted" ? "" : `<button type="button" class="primary" data-action="enable-notify">Allow notifications</button>`}`;
  if (!pushReady) return local;
  return `${local}
    <label class="field">
      <span>Worker token</span>
      <input id="worker-token" type="password" data-bind="workerToken" data-commit="settings" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="The secret from the worker" value="${esc(state.settings.workerToken || "")}" />
    </label>
    ${state.settings.pushOn
      ? `<p class="saved-line">Closed-app reminders are on.</p><button type="button" class="ghost" data-action="push-off">Turn off closed-app reminders</button>`
      : `<button type="button" class="primary" data-action="push-on">Turn on closed-app reminders</button>`}`;
}

function driveSection(state, ui) {
  if (!String(GOOGLE_CLIENT_ID || "").trim()) return "";
  const autoOn = state.settings.driveAutoBackup !== false;
  const lastLabel = formatLastBackupTime(state.settings, new Date());
  const statusSuffix = ui.driveStatus ? ` · ${ui.driveStatus}` : "";
  const needsReconnect = Boolean(ui.driveNeedsReconnect && state.settings.driveLinked);
  return `
    <h2 class="section-title">Google Drive</h2>
    <p class="lede">A hidden folder on your Google account. The Gemini key is not included. Ember keeps the latest 7 backups.</p>
    <p class="lede" data-drive-last>Last backup: ${esc(lastLabel)}${esc(statusSuffix)}</p>
    <button type="button" class="switch" role="switch" aria-checked="${autoOn ? "true" : "false"}" data-action="toggle-setting" data-key="driveAutoBackup"><span>Auto backup</span><i></i></button>
    ${needsReconnect ? `<button type="button" class="primary" data-action="drive-reconnect">Tap to reconnect Drive</button>` : ""}
    <div class="stack-actions">
      <button type="button" class="${needsReconnect ? "ghost" : "primary"}" data-action="drive-backup">${state.settings.driveLinked ? "Back up now" : "Connect Google Drive"}</button>
      <button type="button" class="ghost" data-action="drive-restore">Restore from Drive</button>
    </div>`;
}

function installBlock(standalone, ui) {
  if (standalone) return `<p class="lede">Installed as its own app. The icon should not wear a Chrome badge.</p>`;
  if (ui.installEvent) {
    return `<button type="button" class="primary" data-action="install">Install Ember</button>
      <p class="lede">This uses Chrome’s install prompt, so the home screen gets a real app, not a shortcut.</p>`;
  }
  return `<p class="lede">In Chrome’s menu, choose Install app. If it only says Installera genväg, refresh once and use the menu again. A shortcut keeps the Chrome badge. A real install does not.</p>`;
}

function field(label, inner) {
  return `<label class="field"><span>${label}</span>${inner}</label>`;
}

function lifeRewardSheet(draft) {
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet" data-form="save-life-reward">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Add life reward</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">Something you want in real life, bought with shards when you redeem it.</p>
      ${error}
      ${field("Reward", `<input type="text" data-bind="title" maxlength="80" placeholder="30 min gaming" value="${esc(draft.title || "")}" required />`)}
      ${field("Shard price", `<input type="number" inputmode="numeric" min="1" max="9999" data-bind="price" value="${esc(String(draft.price ?? 20))}" />`)}
      <button type="submit" class="primary">Save reward</button>
    </form>`;
}

export function sheetHtml(state, ui, now = new Date()) {
  if (!ui.sheet) return "";
  const sheet = ui.sheet;
  const draft = ui.draft || {};
  if (sheet.type === "life-reward") return lifeRewardSheet(draft);
  if (sheet.type === "task" || sheet.type === "template") return taskSheet(sheet, draft);
  if (sheet.type === "workout") return workoutSheet(state, draft);
  if (sheet.type === "generate") return generateSheet(draft);
  if (sheet.type === "drive") return driveSheet(ui);
  if (sheet.type === "copy-day") return copyDaySheet(state, sheet, draft, now);
  if (sheet.type === "coach") return coachSheetHtml(draft);
  if (sheet.type === "rival-chat") return rivalChatSheetHtml(draft);
  if (sheet.type === "blocker-picker") return blockerPickerSheet(state, draft);
  return "";
}

function blockerPickerSheet(state, draft) {
  const apps = [...(draft.apps || [])].sort((a, b) =>
    String(a.label || a.id).localeCompare(String(b.label || b.id), undefined, { sensitivity: "base" }),
  );
  const selected = new Set((draft.selected || state.settings.blockedPackages || []).map(String));
  const q = esc(draft.blockedSearch || "");
  const rows = apps
    .map((app) => {
      const on = selected.has(app.id);
      const hay = esc(`${app.label || ""} ${app.id}`.toLowerCase());
      return `<label class="copy-day-row ${on ? "is-checked" : ""}" data-blocked-row data-blocked-search="${hay}">
        <input type="checkbox" data-blocked-app="${esc(app.id)}" ${on ? "checked" : ""} />
        <span class="copy-day-copy"><strong>${esc(app.label || app.id)}</strong><small>${esc(app.id)}</small></span>
      </label>`;
    })
    .join("");
  return `<div class="scrim" data-action="close-sheet"></div>
    <form class="sheet sheet-blocker" data-form="save-blocked-apps">
      <div class="handle"></div>
      <div class="sheet-head"><h2>Blocked apps</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button></div>
      <p class="lede">${state.settings?.blockMode === "quests" ? "Checked apps stay blocked until every quest is done." : "Checked apps ask for your max push-ups, then open for the unlock length."}</p>
      <input type="search" class="blocker-search" data-blocked-search placeholder="Search apps" value="${q}" autocomplete="off" />
      <div class="copy-day-list blocker-app-list" data-blocked-list>${rows || "<p class=muted>No launchable apps found.</p>"}</div>
      <button type="submit" class="primary">Save selection</button>
    </form>`;
}

function copyDaySheet(state, sheet, draft, now) {
  const isTemplate = sheet.kind === "template";
  const copyMode = draft.copyMode === "append" ? "append" : "replace";
  const selectedTargets = new Set((draft.targets || []).map(String));
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";

  let fromLabel = "";
  let sourceCount = 0;
  let options = [];

  if (isTemplate) {
    const srcWd = String(sheet.weekday);
    fromLabel = `${WEEKDAYS[Number(srcWd) - 1] || "Day"} template`;
    sourceCount = templateTaskCount(state, srcWd);
    options = WEEKDAYS.map((name, idx) => {
      const wd = String(idx + 1);
      if (wd === srcWd) return null;
      const existing = templateTaskCount(state, wd);
      return {
        value: wd,
        title: name,
        sub: existing ? `${existing} quest${existing === 1 ? "" : "s"}` : "Empty",
      };
    }).filter(Boolean);
  } else {
    const srcDate = sheet.date;
    const start = weekStart(dateKey(now));
    fromLabel = formatPretty(srcDate);
    sourceCount = taskCount(state, srcDate);
    options = Array.from({ length: 7 }, (_, idx) => {
      const date = addDays(start, idx);
      if (date === srcDate) return null;
      const existing = taskCount(state, date);
      const shortDate = formatPretty(date).replace(/^[A-Za-z]{3}\s/, "");
      return {
        value: date,
        title: WEEKDAYS[idx],
        sub: `${shortDate} · ${existing ? `${existing} quest${existing === 1 ? "" : "s"}` : "Empty"}`,
      };
    }).filter(Boolean);
  }

  const allSelected = options.length > 0 && options.every((opt) => selectedTargets.has(opt.value));
  const rows = options
    .map((opt) => {
      const checked = selectedTargets.has(opt.value);
      return `<label class="copy-day-row ${checked ? "is-checked" : ""}">
        <input type="checkbox" data-copy-target="${esc(opt.value)}" ${checked ? "checked" : ""} />
        <span class="copy-day-copy">
          <strong>${esc(opt.title)}</strong>
          <small>${esc(opt.sub)}</small>
        </span>
      </label>`;
    })
    .join("");

  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet" data-form="save-copy-day">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Copy to other days</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">From ${esc(fromLabel)} (${sourceCount} quest${sourceCount === 1 ? "" : "s"}). Copied quests get fresh IDs and start unchecked.</p>
      ${error}
      <div class="segment" role="group" aria-label="How to copy">
        <button type="button" data-action="set-copy-mode" data-copy-mode="replace" aria-pressed="${copyMode === "replace"}">Replace</button>
        <button type="button" data-action="set-copy-mode" data-copy-mode="append" aria-pressed="${copyMode === "append"}">Add to</button>
      </div>
      <div class="copy-day-head">
        <span class="kicker">Choose days</span>
        <button type="button" class="ghost slim" data-action="copy-select-all">${allSelected ? "Clear all" : "Select all 6"}</button>
      </div>
      <div class="copy-day-list">${rows}</div>
      <button type="submit" class="primary">${copyMode === "replace" ? "Replace on selected days" : "Add to selected days"}</button>
    </form>`;
}

function driveSheet(ui) {
  const files = ui.driveFiles || [];
  const rows = files.length
    ? files.map((file) => `<button type="button" class="ex-row" data-action="drive-pick" data-id="${esc(file.id)}"><span><strong>${esc(file.name || "Backup")}</strong><small>${esc(file.createdTime || "")}</small></span></button>`).join("")
    : `<p class="slot-empty">No Drive backups yet.</p>`;
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <div class="sheet">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Restore from Drive</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">This replaces quests and XP on this phone. Your Gemini key stays if the backup doesn't have one.</p>
      <div class="list">${rows}</div>
    </div>`;
}

function taskSheet(sheet, draft) {
  const editing = Boolean(sheet.taskId);
  const isEvent = Boolean(draft.isEvent);
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";
  const heading = editing
    ? (isEvent ? "Edit event" : "Edit quest")
    : (isEvent ? "New event" : "New quest");
  const submitLabel = isEvent ? "Save event" : "Save quest";
  const deleteLabel = isEvent ? "Delete event" : "Delete quest";
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet" data-form="save-task">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>${heading}</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      ${error}
      ${field("Title", `<input data-bind="title" maxlength="80" required placeholder="${isEvent ? "Exam, dentist, match…" : "What will you actually do?"}" value="${esc(draft.title || "")}">`)}
      ${field("Why it matters", `<input data-bind="why" maxlength="160" placeholder="Optional, one line" value="${esc(draft.why || "")}">`)}
      ${field("Reminder", `<input data-bind="time" type="time" value="${esc(draft.time || "")}">`)}
      <div class="segment">
        ${SLOTS.map((slot) => `<button type="button" data-action="set-slot" data-slot="${slot}" aria-pressed="${(draft.slot || sheet.slot) === slot}">${SLOT_LABEL[slot]}</button>`).join("")}
      </div>
      ${sheet.type === "task" ? `<label class="checkline"><input type="checkbox" data-bind="isEvent" data-rerender-check ${isEvent ? "checked" : ""}> Mark as one-off Event (stands out on the calendar)</label>` : ""}
      ${sheet.type === "task" && !editing && !isEvent ? `<label class="checkline"><input type="checkbox" data-bind="saveTemplate" ${draft.saveTemplate ? "checked" : ""}> Also save onto this weekday’s template</label>` : ""}
      <button type="submit" class="primary">${submitLabel}</button>
      ${editing ? `<button type="button" class="danger" data-action="delete-task">${deleteLabel}</button>` : ""}
    </form>`;
}

function workoutSheet(state, draft) {
  const names = [...new Set([...SUGGESTED_EXERCISES, ...state.workouts.map((item) => item.name)])];
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";
  const sets = (draft.sets || [{ reps: "", weight: "" }])
    .map((set, index) => `<div class="set-row">
        <span class="set-n num">${index + 1}</span>
        <label><span>Reps</span><input data-bind="sets.${index}.reps" inputmode="numeric" value="${esc(set.reps)}"></label>
        <label><span>kg</span><input data-bind="sets.${index}.weight" inputmode="decimal" value="${esc(set.weight)}"></label>
        <button type="button" class="icon-btn" data-action="remove-set" data-index="${index}" aria-label="Remove set" ${(draft.sets || []).length < 2 ? "disabled" : ""}>${icon("close")}</button>
      </div>`)
    .join("");
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet" data-form="save-workout">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Log a session</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      ${error}
      ${field("Exercise", `<input data-bind="name" maxlength="60" required placeholder="Bench press, run…" list="exercise-names" value="${esc(draft.name || "")}"><datalist id="exercise-names">${names.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>`)}
      ${field("Date", `<input data-bind="date" type="date" max="${dateKey(new Date())}" value="${esc(draft.date || "")}">`)}
      <div class="segment">
        <button type="button" data-action="set-kind" data-kind="strength" aria-pressed="${draft.kind !== "cardio"}">Lift</button>
        <button type="button" data-action="set-kind" data-kind="cardio" aria-pressed="${draft.kind === "cardio"}">Run</button>
      </div>
      ${draft.kind === "cardio"
        ? `${field("Minutes", `<input data-bind="minutes" inputmode="decimal" placeholder="25" value="${esc(draft.minutes || "")}">`)}
           ${field("Kilometres", `<input data-bind="km" inputmode="decimal" placeholder="5 or 5,2" value="${esc(draft.km || "")}">`)}`
        : `<div class="sets-editor">${sets}<button type="button" class="add" data-action="add-set">${icon("plus")} Add a set</button></div>`}
      ${field("Note", `<input data-bind="notes" maxlength="160" placeholder="Optional" value="${esc(draft.notes || "")}">`)}
      <button type="submit" class="primary">Save session · 40 XP</button>
    </form>`;
}

function generateSheet(draft) {
  const preview = draft.preview
    ? `<div class="preview">${draft.preview.days
        .map((day) => `<section class="preview-day"><h3>${WEEKDAYS[day.weekday - 1] || "Day"}</h3>${SLOTS.map((slot) =>
          (day[slot] || []).map((task) => `<p><strong>${SLOT_LABEL[slot]}</strong> ${esc(task.time)} ${esc(task.title)}</p>`).join(""),
        ).join("")}</section>`)
        .join("")}</div>`
    : "";
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet" data-form="run-generate">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Generate this week</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">Uses Gemini Flash on the free tier. Without a key, write the week yourself. Your current days stay until you apply a plan.</p>
      ${draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : ""}
      ${field("Goals", `<textarea data-bind="goals" rows="4" maxlength="2000">${esc(draft.goals || "")}</textarea>`)}
      ${field("Gemini key", `<input data-bind="key" type="password" autocomplete="off" placeholder="Stored only on this phone" value="${esc(draft.key || "")}">`)}
      <button type="submit" class="primary" ${draft.loading ? "disabled" : ""}>${draft.loading ? "Writing the week…" : "Ask Gemini"}</button>
      ${preview}
      ${draft.preview ? `<button type="button" class="primary" data-action="apply-generate">Use this plan</button><p class="lede">Replaces the template and any day you haven’t started. Days with a finished quest stay.</p>` : ""}
    </form>`;
}

export function confirmHtml(ui) {
  if (!ui.confirm) return "";
  const item = ui.confirm;
  const list = item.list?.length
    ? `<ul class="confirm-list">${item.list.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : "";
  const body = item.body ? `<p>${esc(item.body)}</p>` : !list ? `<p></p>` : "";
  return `
    <div class="confirm" role="dialog" aria-modal="true">
      <div class="confirm-card">
        <h2>${esc(item.title)}</h2>
        ${body}
        ${list}
        <button type="button" class="primary" data-action="confirm-yes">${esc(item.label)}</button>
        <button type="button" class="ghost" data-action="confirm-no">Cancel</button>
      </div>
    </div>`;
}

export function levelUpHtml(ui) {
  if (!ui.levelUp) return "";
  const { level, crystals } = ui.levelUp;
  const sparks = [
    [40, -70], [-50, -40], [60, 20], [-30, 60], [10, -90], [-70, 10], [80, -20], [-10, 80],
  ]
    .map(([x, y]) => `<i class="spark" style="--x:${x}px;--y:${y}px"></i>`)
    .join("");
  return `
    <div class="levelup" role="dialog" aria-modal="true" aria-labelledby="levelup-title">
      <div class="levelup-card">
        ${sparks}
        <div class="medallion lg"><span class="display">${level}</span></div>
        <p class="kicker">Level up</p>
        <h2 id="levelup-title">Level ${level}</h2>
        <p>The bar filled.</p>
        ${crystals ? `<p class="award">${currencyIcon({ size: 20 })} +${crystals}</p>` : ""}
        <button type="button" class="primary" data-action="dismiss-levelup">Keep going</button>
      </div>
    </div>`;
}

export function navHtml(tab) {
  const items = [
    ["today", "Today", "sun"],
    ["week", "Week", "calendar"],
    ["train", "Train", "dumbbell"],
    ["rivals", "Rivals", "people"],
    ["you", "You", "user"],
    ["settings", "Setup", "gear"],
  ];
  return `<nav class="nav">${items
    .map(([id, label, glyph]) => `<button type="button" data-action="tab" data-tab="${id}" aria-current="${tab === id ? "page" : "false"}">${icon(glyph)}<span>${label}</span></button>`)
    .join("")}</nav>`;
}
