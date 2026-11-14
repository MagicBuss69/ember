import { buildMonthGrid, daySummary, monthKey } from "../calendar.js";
import { GOOGLE_CLIENT_ID, VAPID_PUBLIC_KEY, WORKER_URL } from "../config.js";
import { FREEZE_PRICE, SLOTS, SLOT_LABEL, SUGGESTED_EXERCISES, THEMES } from "../constants.js";
import { templateTaskCount } from "../domain.js";
import { formatLastBackupTime } from "../driveSchedule.js";
import { geminiKeyEnding } from "../gemini.js";
import { levelProgress } from "../economy.js";
import { esc, formatMaybe, formatNum, reasonLabel } from "../format.js";
import { avatar, gemIcon, icon } from "../icons.js";
import { buildBoard } from "../rivals.js";
import { exerciseGroups, rawGap, ringNumbers, streakCount, summarizeWeek, taskCount, totalXp } from "../stats.js";
import { addDays, currentSlot, dateKey, formatPretty, formatWeekSpan, weekdayIso, weekdayLong, weekStart } from "../time.js";
import { emptyState, levelBar, reorderBarHtml, ringHtml, slotSection } from "./bits.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function gapNote(gap, freezes) {
  if (!gap.length) return "";
  const when = gap.length === 1 ? formatPretty(gap[0]) : `${gap.length} days`;
  const have = freezes ? ` You have ${freezes}.` : "";
  const need = gap.length === 1
    ? `One streak freeze repairs it.${have}`
    : `${gap.length} streak freezes would repair it.${have}`;
  return `<p class="note">${gap.length === 1 ? `${esc(when)} is missing from the streak.` : `${esc(when)} are missing from the streak.`} ${esc(need)}</p>`;
}

export function viewToday(state, ui, now) {
  const today = dateKey(now);
  const date = ui.lookDate && ui.lookDate <= today ? ui.lookDate : today;
  const lookingToday = date === today;
  const day = state.days[date];
  const ring = ringNumbers(state, date);
  const progress = levelProgress(totalXp(state));
  const streak = streakCount(state, today);
  const gap = lookingToday ? rawGap(state, today) : [];
  const nowSlot = currentSlot(now);
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
        slotSection({
          slot,
          items: day.slots[slot] || [],
          nowSlot: lookingToday ? nowSlot : null,
          date,
          template: false,
          justDoneId: ui.justDoneId,
          movable: true,
          reordering: Boolean(ui.reordering),
        }),
      ).join("");
    }
  }
  const hasAny = Boolean(day && SLOTS.some((slot) => (day.slots[slot]?.length || 0) > 0));
  const reorderBar = reorderBarHtml(hasAny, Boolean(ui.reordering));
  const hint = lookingToday && !state.settings.dismissedHint
    ? `<div class="hint"><p>Starter week, picked for a school day in Sweden. Change or drag any quest. It only lives on this phone.</p><button type="button" data-action="dismiss-hint">Got it</button></div>`
    : "";
  return `
    <section class="today">
      <div class="hero-today">
        ${ringHtml(ring.done, ring.total, ui.ringPulse)}
        <div class="hero-copy">
          <div class="date-nav">
            <button type="button" class="icon-btn" data-action="shift-day" data-dir="-1" aria-label="Previous day">${icon("chevL")}</button>
            <div class="date-copy">
              <h1>${lookingToday ? "Today" : esc(weekdayLong(date))}</h1>
              <p>${esc(formatPretty(date))}</p>
            </div>
            <button type="button" class="icon-btn" data-action="shift-day" data-dir="1" aria-label="Next day" ${lookingToday ? "disabled" : ""}>${icon("chevR")}</button>
          </div>
          ${levelBar(progress, totalXp(state), ui.barPulse)}
          <p class="streak-line">${icon("flame")} ${streak ? `${streak}-day streak` : "No streak yet"}</p>
        </div>
      </div>
      ${!lookingToday ? `<button type="button" class="ghost slim" data-action="jump-today">Back to today</button>` : ""}
      ${gapNote(gap, state.freezes)}
      ${hint}
      ${reorderBar}
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
  const hasAny = mode === "week"
    ? taskCount(state, selected) > 0
    : templateTaskCount(state, weekday) > 0;
  const reorderBar = reorderBarHtml(hasAny, Boolean(ui.reordering));
  const sections = mode === "week"
    ? SLOTS.map((slot) =>
        slotSection({
          slot,
          items: state.days[selected]?.slots?.[slot] || [],
          nowSlot: selected === today ? currentSlot(now) : null,
          date: selected,
          template: false,
          justDoneId: ui.justDoneId,
          movable: true,
          reordering: Boolean(ui.reordering),
          canToggle: selected <= today,
        }),
      ).join("")
    : SLOTS.map((slot) =>
        slotSection({
          slot,
          items: state.template[weekday]?.[slot] || [],
          date: "",
          weekday,
          template: true,
          justDoneId: null,
          movable: true,
          reordering: Boolean(ui.reordering),
        }),
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
      ${reorderBar}
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
        return slotSection({
          slot,
          items,
          nowSlot: null,
          date: calDate,
          template: false,
          justDoneId: null,
          readOnly: true,
        });
      }).join("");
    }
  } else {
    const canPrefill = !day || summary.questCount === 0;
    const prefillBtn = canPrefill
      ? `<button type="button" class="ghost" data-action="use-template-day" data-date="${calDate}">Use ${esc(weekdayLong(calDate))} template</button>`
      : "";
    const reorderBar = reorderBarHtml(summary.totalCount > 0, Boolean(ui.reordering));
    const slotsHtml = SLOTS.map((slot) =>
      slotSection({
        slot,
        items: day?.slots?.[slot] || [],
        nowSlot: isToday ? nowSlot : null,
        date: calDate,
        template: false,
        justDoneId: ui.justDoneId,
        movable: true,
        reordering: Boolean(ui.reordering),
        canToggle: isToday,
      }),
    ).join("");
    dayBody = `
      <div class="cal-quick">
        <button type="button" class="primary" data-action="add-event" data-date="${calDate}" data-slot="${isToday ? nowSlot : "morning"}">${icon("plus")} Add an event</button>
        ${prefillBtn}
      </div>
      ${reorderBar}
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
  const board = buildBoard(state, now);
  const delta = board.same.delta;
  const deltaText = delta > 0 ? `+${formatNum(delta)}` : delta < 0 ? `−${formatNum(-delta)}` : "0";
  const rows = board.board
    .map((row) => `<article class="board-row ${row.you ? "you" : ""}">
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
      <article class="hero-card tone-${board.same.tone}">
        <p class="kicker">${esc(board.same.kicker)}</p>
        ${board.same.mode === "score" ? `<p class="delta">${deltaText}<small> XP</small></p>` : ""}
        <h2>${esc(board.same.headline)}</h2>
        <p class="detail">${esc(board.same.detail)}</p>
        <div class="race">
          <div class="race-row"><span>You today</span><span class="num">${formatNum(board.same.todayXp)}</span></div>
          <div class="track"><span style="transform:scaleX(${Math.max(0, Math.min(1, board.same.youPct)).toFixed(4)})"></span></div>
          <div class="race-row"><span>Last ${esc(board.same.weekdayName)}</span><span class="num">${formatNum(board.same.thenXp)}</span></div>
          <div class="track ghost"><span style="transform:scaleX(${Math.max(0, Math.min(1, board.same.ghostPct)).toFixed(4)})"></span></div>
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
      <h2 class="section-title">This week</h2>
      <div class="board">${rows}</div>
      <h2 class="section-title">Activity</h2>
      <div class="feed">${feed}</div>
      <p class="footnote">Leo, Maja, Noah, and Amina are simulated on this phone. They are not accounts, and no one else can see this.</p>
    </section>`;
}

export function viewYou(state, ui) {
  const xp = totalXp(state);
  const progress = levelProgress(xp);
  const streak = streakCount(state, dateKey(new Date()));
  const gap = rawGap(state, dateKey(new Date()));
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const themes = THEMES.map((theme) => {
    const owned = state.ownedThemes.includes(theme.id);
    const active = state.settings.theme === theme.id;
    const afford = state.crystals >= theme.price;
    const action = owned
      ? `<button type="button" class="ghost tiny ${active ? "is-on" : ""}" data-action="equip-theme" data-theme="${theme.id}" aria-pressed="${active}">${active ? "Using" : "Use"}</button>`
      : `<button type="button" class="ghost tiny" data-action="ask-buy-theme" data-theme="${theme.id}" ${afford ? "" : "disabled"}>${theme.price} ${gemIcon()}</button>`;
    return `<article class="theme ${active ? "on" : ""}">
      <span class="swatch" data-swatch="${theme.id}"></span>
      <span><strong>${esc(theme.name)}</strong><small>${esc(theme.blurb)}</small></span>
      ${action}
    </article>`;
  }).join("");
  const log = state.crystalLog.length
    ? `<ul class="log">${state.crystalLog
        .slice(0, 6)
        .map((entry) => `<li><span>${esc(reasonLabel(entry.reason))}</span><span class="num ${entry.delta < 0 ? "neg" : ""}">${entry.delta > 0 ? "+" : ""}${entry.delta}</span></li>`)
        .join("")}</ul>`
    : `<p class="slot-empty">Crystals you earn and spend show up here.</p>`;
  const perm = ui.notifyState || "default";
  const permLabel = perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Not available" : "Not asked yet";
  const periodic = ui.periodic === "registered"
    ? "A background check is registered. Chrome still picks the hour."
    : ui.periodic === "unsupported"
      ? "This browser has no background check."
      : "Background check starts after you install Ember and allow notifications.";
  return `
    <section>
      <h1 class="page-title">You</h1>
      <div class="you-hero">
        <div class="medallion" aria-hidden="true"><span class="display">${progress.level}</span></div>
        <p class="kicker">Level ${progress.level} of 10</p>
        <h2>${progress.maxed ? "The top of the scale." : `${formatNum(progress.span - progress.into)} XP to level ${progress.level + 1}`}</h2>
        ${levelBar(progress, xp, ui.barPulse)}
        <p class="lede">Quests pay 25 XP. A training session pays 40. The streak counts finished quests, not workouts.</p>
      </div>
      <div class="stat-grid">
        <div class="stat"><strong class="num">${streak}</strong><span>day streak</span></div>
        <div class="stat"><strong class="num">${state.longest || 0}</strong><span>longest</span></div>
        <div class="stat"><strong class="num">${state.freezes}</strong><span>freezes</span></div>
        <div class="stat"><strong class="num">${formatNum(state.crystals)}</strong><span>crystals</span></div>
      </div>
      ${gapNote(gap, state.freezes)}
      <h2 class="section-title" id="shop">Shop</h2>
      <article class="theme">
        <span class="swatch gem-swatch">${gemIcon()}</span>
        <span><strong>Streak freeze</strong><small>Covers one missed day, if you have enough for the whole gap.</small></span>
        <button type="button" class="ghost tiny" data-action="ask-buy-freeze" ${state.crystals >= FREEZE_PRICE ? "" : "disabled"}>${FREEZE_PRICE} ${gemIcon()}</button>
      </article>
      ${themes}
      ${log}
      <h2 class="section-title">Goals</h2>
      <label class="field">
        <span>What this week is for</span>
        <textarea id="goals" rows="4" data-bind="goals" data-commit="settings" maxlength="2000">${esc(state.settings.goals)}</textarea>
      </label>
      <h2 class="section-title">Gemini</h2>
      <p class="lede">Optional. Ember works with no key. The key stays on this phone. Generating a week sends your goals to Google’s free Gemini API, which may use free-tier text to improve Google’s products.</p>
      ${geminiCard(state, ui)}
      <p class="lede"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a free key in Google AI Studio</a></p>
      <h2 class="section-title">Reminders</h2>
      ${reminderBlock(state, ui, permLabel, periodic)}
      <h2 class="section-title">This phone</h2>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.sound ? "true" : "false"}" data-action="toggle-setting" data-key="sound"><span>Sounds</span><i></i></button>
      <button type="button" class="switch" role="switch" aria-checked="${state.settings.haptics ? "true" : "false"}" data-action="toggle-setting" data-key="haptics"><span>Vibration</span><i></i></button>
      <div class="stack-actions">
        <button type="button" class="ghost" data-action="export">${icon("download")} Export backup</button>
        <button type="button" class="ghost" data-action="import">${icon("upload")} Import backup</button>
      </div>
      <p class="lede">The file backup includes your Gemini key if you saved one. Don’t post it anywhere.</p>
      ${driveSection(state, ui)}
      <h2 class="section-title">Install</h2>
      ${installBlock(standalone, ui)}
      <button type="button" class="danger" data-action="ask-reset">Erase everything on this phone</button>
      <p class="footnote">Ember 1 · Europe/Stockholm · on this phone only</p>
    </section>`;
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
  const local = `<p class="lede">Status: ${esc(permLabel)}. ${esc(periodic)}</p>
    <p class="lede">While Ember is open, a quest notifies you at its time. If the app was closed, you get it the next time you open Ember, unless closed-app reminders are turned on below.</p>
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

export function sheetHtml(state, ui, now = new Date()) {
  if (!ui.sheet) return "";
  const sheet = ui.sheet;
  const draft = ui.draft || {};
  if (sheet.type === "task" || sheet.type === "template") return taskSheet(sheet, draft);
  if (sheet.type === "workout") return workoutSheet(state, draft);
  if (sheet.type === "generate") return generateSheet(draft);
  if (sheet.type === "drive") return driveSheet(ui);
  if (sheet.type === "copy-day") return copyDaySheet(state, sheet, draft, now);
  return "";
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
  return `
    <div class="confirm" role="dialog" aria-modal="true">
      <div class="confirm-card">
        <h2>${esc(item.title)}</h2>
        <p>${esc(item.body)}</p>
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
        ${crystals ? `<p class="award">${gemIcon()} +${crystals}</p>` : ""}
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
  ];
  return `<nav class="nav">${items
    .map(([id, label, glyph]) => `<button type="button" data-action="tab" data-tab="${id}" aria-current="${tab === id ? "page" : "false"}">${icon(glyph)}<span>${label}</span></button>`)
    .join("")}</nav>`;
}
