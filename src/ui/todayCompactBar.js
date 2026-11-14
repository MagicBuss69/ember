import { formatNum } from "../format.js";
import { levelProgress } from "../economy.js";
import { gemIcon } from "../art.js";
import { ringNumbers, totalXp } from "../stats.js";
import { dateKey, formatPretty } from "../time.js";
import { esc } from "../format.js";
import { ringHtml } from "./bits.js";
import {
  COMPACT_BAR_PEEK_PX,
  compactBarFromScroll,
} from "./todayCompact.js";

export function todayCompactBarHtml(state, ui, now) {
  const today = dateKey(now);
  const date = ui.lookDate && ui.lookDate <= today ? ui.lookDate : today;
  if (date !== today) return "";
  const ring = ringNumbers(state, date);
  const xp = totalXp(state);
  const progress = levelProgress(xp);
  const railShards = `${formatNum(state.crystals)} ${gemIcon({ size: 14 })}`;
  const scale = Math.max(0, Math.min(1, Number(progress.pct) || 0)).toFixed(4);
  const compactTitle = `Today · ${formatPretty(date)}`;
  return `
    <div class="today-board-compact-inner">
      <div class="board-compact-row">
        ${ringHtml(ring.done, ring.total, false, { compact: true })}
        <p class="board-compact-title">${esc(compactTitle)}</p>
        <span class="board-compact-lv num">Lv ${progress.level}</span>
        <span class="board-compact-shards num">${railShards}</span>
      </div>
      <div class="board-compact-progress">
        <div class="bar board-compact-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.pct * 100)}" aria-label="Level progress">
          <span data-bar data-pct="${scale}" style="transform:scaleX(${scale})"></span>
        </div>
      </div>
    </div>`;
}

let compactRaf = 0;
let compactShown = false;
let tabGetter = () => "today";

export function readMaxScrollTop() {
  const main = document.getElementById("main");
  const mainScroll = main?.scrollTop ?? 0;
  const docScroll = document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
  return Math.max(mainScroll, docScroll);
}

export function expandedBottomInScrollSpace() {
  const expanded = document.getElementById("today-board-expanded");
  const main = document.getElementById("main");
  if (!expanded || !main) return 0;
  const scrollTop = readMaxScrollTop();
  const mainRect = main.getBoundingClientRect();
  const expRect = expanded.getBoundingClientRect();
  return scrollTop + (expRect.bottom - mainRect.top);
}

export function shouldShowTodayCompactBar() {
  const expanded = document.getElementById("today-board-expanded");
  const main = document.getElementById("main");
  const scrollTop = readMaxScrollTop();
  const bottom = expandedBottomInScrollSpace();
  const fromScroll = compactBarFromScroll(scrollTop, bottom);
  if (!expanded || !main) return fromScroll;
  const mainRect = main.getBoundingClientRect();
  const expRect = expanded.getBoundingClientRect();
  const fromGeometry = expRect.bottom < mainRect.top + COMPACT_BAR_PEEK_PX;
  return fromScroll || fromGeometry;
}

export function setTodayCompactBarVisible(show) {
  if (show === compactShown) return;
  compactShown = show;
  document.body.classList.toggle("today-compact-on", show);
  document.getElementById("today-board-compact")?.setAttribute("aria-hidden", show ? "false" : "true");
}

export function resetTodayCompactBarVisible() {
  compactShown = false;
  document.body.classList.remove("today-compact-on");
  document.getElementById("today-board-compact")?.setAttribute("aria-hidden", "true");
}

export function refreshTodayCompactBarMarkup(state, ui, now) {
  const host = document.getElementById("today-board-compact");
  if (!host) return;
  if (ui.tab !== "today") {
    host.innerHTML = "";
    host.classList.add("is-dormant");
    resetTodayCompactBarVisible();
    return;
  }
  const html = todayCompactBarHtml(state, ui, now);
  host.innerHTML = html;
  host.classList.toggle("is-dormant", !html);
  if (!html) resetTodayCompactBarVisible();
}

export function evaluateTodayCompactScroll() {
  compactRaf = 0;
  if (tabGetter() !== "today") {
    if (compactShown) setTodayCompactBarVisible(false);
    return;
  }
  const host = document.getElementById("today-board-compact");
  if (!host?.querySelector(".today-board-compact-inner")) {
    if (compactShown) setTodayCompactBarVisible(false);
    return;
  }
  setTodayCompactBarVisible(shouldShowTodayCompactBar());
}

export function scheduleTodayCompactScroll() {
  if (compactRaf) return;
  compactRaf = requestAnimationFrame(evaluateTodayCompactScroll);
}

export function installTodayCompactScroll(getTab) {
  tabGetter = getTab;
  const onScroll = () => scheduleTodayCompactScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  scheduleTodayCompactScroll();
}