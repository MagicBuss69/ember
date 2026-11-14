import { SLOTS, SLOT_LABEL } from "../constants.js";
import { formatNum, esc } from "../format.js";
import { icon } from "../icons.js";

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
  const pct = (progress.pct * 100).toFixed(2);
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
        <span data-bar style="width:${pct}%"></span>
      </div>
    </div>`;
}

export function emptyState({ title, body, actions = "" }) {
  return `
    <div class="empty">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${actions}
    </div>`;
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
}) {
  const slotIdx = SLOTS.indexOf(slot);
  const rows = items
    .map((task, index) => {
      const meta = [task.time, !task.done && task.why ? task.why : ""].filter(Boolean).join("  ·  ");
      const eventBadge = task.isEvent ? `<span class="event-pill">Event</span>` : "";
      const titleHtml = `<span class="quest-head"><span class="quest-title">${esc(task.title)}</span>${eventBadge}</span>`;
      if (readOnly) {
        return `
          <div class="quest ${task.done ? "done" : ""} ${task.isEvent ? "is-event" : ""} is-readonly">
            <span class="check static" aria-hidden="true"><i class="${task.done ? "is-done" : ""}"></i></span>
            <div class="quest-body static">
              ${titleHtml}
              ${meta ? `<span class="quest-meta">${esc(meta)}</span>` : ""}
            </div>
          </div>`;
      }
      const where = template
        ? `data-weekday="${weekday}" data-slot="${slot}" data-id="${esc(task.id)}"`
        : `data-date="${date}" data-slot="${slot}" data-id="${esc(task.id)}"`;
      const check = template || !canToggle
        ? ""
        : `<button type="button" class="check ${justDoneId === task.id ? "just" : ""}" data-action="toggle" ${where} aria-pressed="${task.done ? "true" : "false"}" aria-label="${task.done ? "Mark not done" : "Mark done"}: ${esc(task.title)}"><i></i></button>`;
      const atVeryTop = slotIdx === 0 && index === 0;
      const atVeryBottom = slotIdx === SLOTS.length - 1 && index === items.length - 1;
      const stepper = movable && reordering
        ? `<div class="move-btns">
            <button type="button" class="icon-btn move-step" data-action="step-quest" data-dir="-1" ${where} aria-label="Move up: ${esc(task.title)}" ${atVeryTop ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-btn move-step" data-action="step-quest" data-dir="1" ${where} aria-label="Move down: ${esc(task.title)}" ${atVeryBottom ? "disabled" : ""}>${icon("down")}</button>
          </div>`
        : "";
      const grip = movable
        ? `<button type="button" class="grip" data-grip ${where} aria-label="Drag to move: ${esc(task.title)}">${icon("grip")}</button>`
        : "";
      const rowAttrs = movable
        ? `data-quest data-date="${date}" data-slot="${slot}" data-id="${esc(task.id)}"`
        : "";
      return `
        <div class="quest ${task.done ? "done" : ""} ${task.isEvent ? "is-event" : ""} ${!template && !canToggle ? "no-check" : ""} ${reordering ? "reordering" : ""}" ${rowAttrs}>
          ${check}
          <button type="button" class="quest-body" data-action="${template ? "edit-template" : "edit-task"}" ${where}>
            ${titleHtml}
            ${meta ? `<span class="quest-meta">${esc(meta)}</span>` : ""}
          </button>
          ${stepper}
          ${grip}
        </div>`;
    })
    .join("");
  if (readOnly) return rows;
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
}) {
  const done = items.filter((task) => task.done).length;
  const dropAttrs = movable ? `data-slot-drop="${slot}" data-date="${date}"` : "";
  const countText = template || !canToggle ? String(items.length) : `${done}/${items.length}`;
  return `
    <section class="slot">
      <header>
        <h2>${SLOT_LABEL[slot]}</h2>
        ${!template && slot === nowSlot ? `<span class="now">Now</span>` : ""}
        <span class="count num">${countText}</span>
      </header>
      <div class="slot-card" ${dropAttrs}>
        ${items.length ? "" : `<p class="slot-empty">Nothing ${SLOT_LABEL[slot].toLowerCase()}.</p>`}
        ${questRows({ items, date, weekday, slot, template, justDoneId, movable, reordering, readOnly, canToggle })}
      </div>
    </section>`;
}
