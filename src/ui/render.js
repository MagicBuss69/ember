import { esc, formatNum } from "../format.js";
import { gemIcon } from "../icons.js";
import { confirmHtml, levelUpHtml, navHtml, penaltyHtml, sheetHtml, viewRivals, viewSettings, viewToday, viewTrain, viewWeek, viewYou } from "./screens.js";

const VIEWS = {
  today: viewToday,
  week: viewWeek,
  train: viewTrain,
  rivals: viewRivals,
  you: viewYou,
  settings: viewSettings,
};

export function render(state, ui, now) {
  const tab = VIEWS[ui.tab] ? ui.tab : "today";
  const view = VIEWS[tab];
  return `
    <div class="app">
      <header class="hud">
        <div class="brand"><i class="brand-dot"></i>Ember</div>
        <button type="button" class="shard-btn hud-wallet" data-action="goto-shop" data-shard-hud aria-label="${formatNum(state.crystals)} shards in wallet">
          <span class="shard-mark ${ui.gemShine ? "shine" : ""}">${gemIcon({ size: 22 })}</span>
          <span class="shard-count num" data-crystals>${formatNum(state.crystals)}</span>
        </button>
      </header>
      <main class="${ui.enter ? "enter" : ""}" id="main">${view(state, ui, now)}</main>
      ${navHtml(tab)}
      ${sheetHtml(state, ui, now)}
      ${confirmHtml(ui)}
      ${levelUpHtml(ui)}
      ${penaltyHtml(ui)}
    </div>`;
}

export function shellError(message) {
  return `<div class="app"><main><div class="empty"><h3>Ember hit a snag</h3><p>${esc(message)}</p><button type="button" class="primary" onclick="location.reload()">Reload</button></div></main></div>`;
}
