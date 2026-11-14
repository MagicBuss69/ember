import { SLOTS, SLOT_LABEL } from "../constants.js";
import { formatNum, esc } from "../format.js";
import { crystalGemSvg, icon } from "../icons.js";
import { rankForLevel } from "../rank.js";

const RADIUS = 36;
export const RING_CIRC = 2 * Math.PI * RADIUS;

export function ringHtml(done, total, pulse) {
  const pct = total ? done / total : 0;
  const offset = pct <= 0 ? RING_CIRC : RING_CIRC * (1 - pct);
  return `
    <div class="ring-wrap ${pulse ? "pulse" : ""} ${pct <= 0 ? "is-empty" : ""} ${pct >= 1 ? "is-full" : ""}">
      <svg class="ring" viewBox="0 0 88 88" role="img" aria-label="${done} of ${total} quests done">
        <circle class="ring-track" cx="44" cy="44" r="${RADIUS}"></circle>
        <circle class="ring-fg" data-ring cx="44" cy="44" r="${RADIUS}"
          stroke-dasharray="${RING_CIRC.toFixed(3)}"
          style="stroke-dashoffset:${offset.toFixed(3)}"
          transform="rotate(-90 44 44)"></circle>
      </svg>
      <div class="ring-label"><strong>${done}</strong><small>/${total}</small></div>
    </div>`;
}

export function levelBar(progress, total, pulse) {
  const scale = Math.max(0, Math.min(1, Number(progress.pct) || 0)).toFixed(4);
  const right = progress.maxed
    ? `${formatNum(total)} XP`
    : `${formatNum(progress.into)} / ${formatNum(progress.span)}`;
  return `
    <div class="level-block">
      <div class="level-row">
        <span>Level ${progress.level}</span>
        <span class="num">${right}</span>
      </div>
      <div class="bar ${pulse ? "pulse" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.pct * 100)}" aria-label="Level progress">
        <span data-bar data-pct="${scale}" style="transform:scaleX(${scale})"></span>
      </div>
    </div>`;
}

export function crystalMeterHtml({ progress, rank, stress = 0, pulse = false, skin = "default", compact = false }) {
  const fill = Math.max(0, Math.min(1, Number(progress.pct) || 0));
  const stressCl = stress > 0.55 ? "is-cracked" : stress > 0.25 ? "is-dim" : "";
  const rankLetter = rank || rankForLevel(progress.level);
  const gemSize = compact ? 44 : 52;
  return `
    <div class="crystal-meter ${compact ? "is-compact" : ""} ${stressCl} skin-${esc(skin)}" data-crystal-meter>
      <div class="rank-chip" aria-label="Rank ${rankLetter}"><span class="display">${esc(rankLetter)}</span></div>
      <div class="crystal-gem-wrap ${pulse ? "pulse" : ""}" aria-hidden="true">
        ${crystalGemSvg({ size: gemSize, fillPct: fill, className: "crystal-svg hero-gem" })}
      </div>
      <div class="crystal-copy">
        <strong class="display">Lv ${progress.level}</strong>
        <span class="num crystal-xp">${progress.maxed ? "MAX" : `${Math.round(progress.pct * 100)}%`}</span>
      </div>
    </div>`;
}

export function weekChartHtml(compare) {
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const peak = Math.max(1, ...compare.thisBars, ...compare.lastBars);
  const bars = labels
    .map((label, i) => {
      const thisXp = compare.thisBars[i] || 0;
      const lastXp = compare.lastBars[i] || 0;
      const thisH = Math.max(4, Math.round((thisXp / peak) * 100));
      const lastH = Math.max(4, Math.round((lastXp / peak) * 100));
      const future = i > compare.dayIndex;
      return `<div class="wc-day ${future ? "is-future" : ""}">
        <div class="wc-bars">
          <i class="wc-last" style="transform:scaleY(${(lastH / 100).toFixed(3)})" title="${lastXp} XP"></i>
          <i class="wc-this" style="transform:scaleY(${(thisH / 100).toFixed(3)})" title="${thisXp} XP"></i>
        </div>
        <span class="wc-label">${label}</span>
      </div>`;
    })
    .join("");
  const weekTone = compare.weekDelta >= 0 ? "ahead" : "behind";
  const dayTone = compare.sameDayDelta >= 0 ? "ahead" : "behind";
  const daySign = compare.sameDayDelta >= 0 ? "+" : "−";
  return `
    <article class="card week-chart tone-${weekTone}">
      <h2>This week vs last</h2>
      <p class="chart-legend"><span class="dot this">This week</span><span class="dot last">Last week</span></p>
      <div class="wc-grid">${bars}</div>
      <p class="chart-summary num">
        Week: <strong class="${weekTone}">${compare.weekDelta >= 0 ? "+" : "−"}${Math.abs(compare.weekDelta)} XP</strong>
        · Today vs last ${labels[compare.dayIndex]}: <strong class="${dayTone}">${daySign}${Math.abs(compare.sameDayDelta)} XP</strong>
      </p>
    </article>`;
}

export function emptyState({ title, body, actions = "" }) {
  return `
    <div class="empty">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${actions}
    </div>`;
}

function doneSlotKey({ date, weekday, slot, template }) {
  if (template) return `t|${weekday}|${slot}`;
  return `d|${date}|${slot}`;
}

function doneDrawerRow({ doneKey, doneCount, expanded, allCleared }) {
  if (!doneCount) return "";
  const label = allCleared && !expanded ? "Section cleared" : `Done (${doneCount})`;
  const sub = allCleared && !expanded ? `${doneCount} quest${doneCount === 1 ? "" : "s"}` : expanded ? "Tap to hide" : "Tap to view or undo";
  return `
    <button type="button" class="done-drawer ${allCleared && !expanded ? "is-cleared" : ""} ${expanded ? "is-open" : ""}"
      data-action="toggle-done-drawer" data-done-key="${esc(doneKey)}" aria-expanded="${expanded ? "true" : "false"}">
      <span class="done-drawer-glyph" aria-hidden="true">${allCleared && !expanded ? "✦" : icon("chevR")}</span>
      <span class="done-drawer-copy">
        <strong>${esc(label)}</strong>
        <small>${esc(sub)}</small>
      </span>
    </button>`;
}

export function questRows({
  items,
  date,
  weekday,
  slot,
  template,
  justDoneId,
  movable,
  reordering,
  readOnly = false,
  canToggle = true,
  collapsingId = null,
  showAdd = true,
  questXp = 0,
}) {
  const slotIdx = SLOTS.indexOf(slot);
  const rows = items
    .map((task, index) => {
      const meta = [task.time, !task.done && task.why ? task.why : ""].filter(Boolean).join("  ·  ");
      const eventBadge = task.isEvent ? `<span class="event-pill">Event</span>` : "";
      const locked = Boolean(task.penaltyTag);
      const penaltyBadge = locked ? `<span class="event-pill penalty-pill">Must-do</span>` : "";
      const xpBadge = !task.done && questXp && !locked ? `<span class="xp-pill num">+${questXp} XP</span>` : "";
      const titleHtml = `<span class="quest-head"><span class="quest-title">${esc(task.title)}</span>${penaltyBadge}${eventBadge}</span>`;
      const collapsing = collapsingId === task.id ? "is-collapsing" : "";
      if (readOnly) {
        return `
          <div class="quest ${task.done ? "done" : ""} ${task.isEvent ? "is-event" : ""} is-readonly ${collapsing}" data-row-id="${esc(task.id)}">
            <span class="check static" aria-hidden="true"><i class="${task.done ? "is-done" : ""}"></i></span>
            <div class="quest-body static">
              ${titleHtml}
              ${meta ? `<span class="quest-meta">${esc(meta)}</span>` : ""}
            </div>
          </div>`;
      }
      const where = template
        ? `data-template="true" data-weekday="${weekday}" data-slot="${slot}" data-id="${esc(task.id)}"`
        : `data-date="${date}" data-slot="${slot}" data-id="${esc(task.id)}"`;
      const check = template || !canToggle
        ? ""
        : `<button type="button" class="check ${justDoneId === task.id ? "just" : ""}" data-action="toggle" ${where} aria-pressed="${task.done ? "true" : "false"}" aria-label="${task.done ? "Mark not done" : "Mark done"}: ${esc(task.title)}"><i></i></button>`;
      const atVeryTop = slotIdx === 0 && index === 0;
      const atVeryBottom = slotIdx === SLOTS.length - 1 && index === items.length - 1;
      const allowMove = movable && !locked;
      const stepper = allowMove
        ? `<div class="move-btns">
            <button type="button" class="icon-btn move-step" data-action="step-quest" data-dir="-1" ${where} aria-label="Move up: ${esc(task.title)}" ${atVeryTop ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-btn move-step" data-action="step-quest" data-dir="1" ${where} aria-label="Move down: ${esc(task.title)}" ${atVeryBottom ? "disabled" : ""}>${icon("down")}</button>
          </div>`
        : "";
      const grip = allowMove
        ? `<button type="button" class="grip" data-grip ${where} aria-label="Drag to move: ${esc(task.title)}">${icon("grip")}</button>`
        : "";
      const rowAttrs = `data-row-id="${esc(task.id)}" ${allowMove ? `data-quest ${where}` : ""}`;
      const noCheck = template || !canToggle;
      const toggled = justDoneId === task.id ? "just-toggled" : "";
      return `
        <div class="quest ${task.done ? "done" : ""} ${task.isEvent ? "is-event" : ""} ${task.penaltyTag ? "is-penalty" : ""} ${noCheck ? "no-check" : ""} ${movable ? "reordering" : ""} ${toggled} ${collapsing}" ${rowAttrs}>
          ${check}
          ${
            locked
              ? `<div class="quest-body static locked">${titleHtml}${meta ? `<span class="quest-meta">${esc(meta)}</span>` : ""}${xpBadge}</div>`
              : `<button type="button" class="quest-body" data-action="${template ? "edit-template" : "edit-task"}" ${where}>
            ${titleHtml}${xpBadge}
            ${meta ? `<span class="quest-meta">${esc(meta)}</span>` : ""}
          </button>`
          }
          ${stepper}
          ${grip}
        </div>`;
    })
    .join("");
  if (readOnly || !showAdd) return rows;
  const addWhere = template
    ? `data-weekday="${weekday}" data-slot="${slot}"`
    : `data-date="${date}" data-slot="${slot}"`;
  return `
    ${rows}
    <button type="button" class="add" data-action="${template ? "add-template" : "add-task"}" ${addWhere}>${icon("plus")} Add a quest</button>`;
}

export function slotSection({
  slot,
  items,
  nowSlot,
  date,
  weekday,
  template,
  justDoneId,
  movable = false,
  reordering = false,
  readOnly = false,
  canToggle = true,
  doneSlotsOpen = {},
  collapsingId = null,
  questXp = 0,
}) {
  const done = items.filter((task) => task.done).length;
  const dropTarget = template
    ? `data-template="true" data-weekday="${weekday}"`
    : `data-date="${date}"`;
  const dropAttrs = movable ? `data-slot-drop="${slot}" ${dropTarget}` : "";
  const countText = template || !canToggle ? String(items.length) : `${done}/${items.length}`;
  const hideDone = !template;
  const doneKey = hideDone ? doneSlotKey({ date, weekday, slot, template }) : "";
  const doneExpanded = hideDone && Boolean(doneSlotsOpen[doneKey]);
  const doneItems = hideDone ? items.filter((task) => task.done && task.id !== collapsingId) : [];
  const openItems = hideDone
    ? items.filter((task) => !task.done || task.id === collapsingId)
    : items;
  const allCleared = hideDone && items.length > 0 && done === items.length;
  const showDrawer = hideDone && doneItems.length > 0;
  const onlyCleared = showDrawer && openItems.length === 0 && !doneExpanded;

  let cardInner = "";
  if (!items.length) {
    cardInner = `<p class="slot-empty">Nothing ${SLOT_LABEL[slot].toLowerCase()}.</p>`;
  } else if (onlyCleared) {
    cardInner = doneDrawerRow({ doneKey, doneCount: doneItems.length, expanded: false, allCleared: true });
  } else {
  cardInner = questRows({
    items: openItems,
    date,
    weekday,
    slot,
    template,
    justDoneId,
    movable,
    reordering,
    readOnly,
    canToggle,
    collapsingId,
    questXp,
  });
    if (doneExpanded && doneItems.length) {
      cardInner += `<div class="done-list">`;
      cardInner += questRows({
        items: doneItems,
        date,
        weekday,
        slot,
        template,
        justDoneId,
        movable,
        reordering,
        readOnly,
        canToggle,
        collapsingId,
        showAdd: false,
        questXp,
      });
      cardInner += `</div>`;
    }
    if (showDrawer && !onlyCleared) {
      cardInner += doneDrawerRow({
        doneKey,
        doneCount: doneItems.length,
        expanded: doneExpanded,
        allCleared: allCleared && openItems.length === 0,
      });
    }
  }

  return `
    <section class="slot ${allCleared ? "slot-all-done" : ""}">
      <header>
        <h2>${SLOT_LABEL[slot]}</h2>
        ${!template && slot === nowSlot ? `<span class="now">Now</span>` : ""}
        <span class="count num">${countText}</span>
      </header>
      <div class="slot-card ${allCleared ? "is-cleared" : ""} ${doneExpanded ? "has-done-open" : ""}" ${dropAttrs}>
        ${cardInner}
      </div>
    </section>`;
}