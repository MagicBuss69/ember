import { esc, formatNum } from "../format.js";
import { gemIcon } from "../icons.js";
import { confirmHtml, levelUpHtml, navHtml, sheetHtml, viewRivals, viewToday, viewTrain, viewWeek, viewYou } from "./screens.js";

const VIEWS = {
  today: viewToday,
  week: viewWeek,
  train: viewTrain,
  rivals: viewRivals,
  you: viewYou,
};

export function render(state, ui, now) {
  const tab = VIEWS[ui.tab] ? ui.tab : "today";
  const view = VIEWS[tab];
  return `
    <div class="app">
      <header class="hud">
        <div class="brand"><i class="brand-dot"></i>Ember</div>
        <button type="button" class="crystal-btn" data-action="goto-shop" aria-label="${formatNum(state.crystals)} crystals">
          <span class="gem ${ui.gemShine ? "shine" : ""}">${gemIcon()}</span>
          <span class="num" data-crystals>${formatNum(state.crystals)}</span>
        </button>
      </header>
      <main class="${ui.enter ? "enter" : ""}" id="main">${view(state, ui, now)}</main>
      ${navHtml(tab)}
      ${sheetHtml(state, ui)}
      ${confirmHtml(ui)}
      ${levelUpHtml(ui)}
    </div>`;
}

export function shellError(message) {
  return `<div class="app"><main><div class="empty"><h3>Ember hit a snag</h3><p>${esc(message)}</p><button type="button" class="primary" onclick="location.reload()">Reload</button></div></main></div>`;
}
