import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-500.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "@fontsource/fraunces/latin-600.css";
import "./styles.css";

import { formatRestoreSummary, parseBackupText, sanitizeImport, summarizeBackup } from "./backup.js";
import { addMonths, monthKey } from "./calendar.js";
import { GOOGLE_CLIENT_ID } from "./config.js";
import { downloadBackup, listBackups, pruneBackups, restoreKeepingSecrets, uploadBackup } from "./drive.js";
import { clearDriveToken, requestDriveToken } from "./driveAuth.js";
import { createAutoBackupController } from "./driveSchedule.js";
import { checkGeminiKey } from "./gemini.js";
import { disableClosedReminders, enableClosedReminders } from "./pushClient.js";
import { THEMES } from "./constants.js";
import {
  acknowledgePenalty,
  addTask,
  addTemplateTask,
  addWorkout,
  applyGeneratedPlan,
  applyTemplateToOpenDays,
  buyTheme,
  copyDayToDates,
  copyDayToTemplate,
  copyTemplateWeekday,
  createInitialState,
  deleteTask,
  deleteTemplateTask,
  deleteWorkout,
  equipTheme,
  moveTask,
  moveTemplateTask,
  occupiedCopyTargets,
  patchSettings,
  prepare,
  replaceDayFromTemplate,
  setTaskDone,
  stepTask,
  stepTemplateTask,
  updateTask,
  updateTemplateTask,
} from "./domain.js";
import { levelFor } from "./economy.js";
import { parseNum, reasonLabel } from "./format.js";
import { generateWeek } from "./gemini.js";
import { kvClear, loadState, saveState } from "./idb.js";
import {
  enableNotifications,
  periodicStatus,
  registerServiceWorker,
  syncReminderSchedule,
  watchReminders,
} from "./notify.js";
import { ensureRivalHistory } from "./rivals.js";
import { exerciseGroups, isComplete, openTodayCount, totalXp } from "./stats.js";
import { addCustomReward, buyItem, equipCosmetic, redeemCustomReward, SHOP_CATALOG } from "./shop.js";
import { playSound } from "./sounds.js";
import { burstAt, confettiFan, dailyCompleteBanner, shardBurstToCrystal } from "./ui/fx.js";
import { addDays, dateKey, formatPretty, weekStart } from "./time.js";
import { render, shellError } from "./ui/render.js";

const TABS = ["today", "week", "train", "rivals", "you", "settings"];
const THEME_BG = {
  ember: "#100e0c",
  pine: "#0d1210",
  frost: "#0a1420",
  ink: "#070708",
  aurora: "#0a1018",
  blood: "#140808",
};

let state = createInitialState();
let appliedTheme = "";
let prevListScope = "";
const ui = {
  tab: "today",
  lookDate: null,
  weekMode: "week",
  selectedDate: null,
  selectedWeekday: null,
  calMonth: null,
  calDate: null,
  sheet: null,
  draft: null,
  confirm: null,
  levelUp: null,
  exercise: null,
  enter: true,
  keepScroll: false,
  barPulse: false,
  gemShine: false,
  ringPulse: false,
  justDoneId: null,
  focusSheet: false,
  installEvent: null,
  periodic: "unknown",
  notifyState: "default",
  revealKey: false,
  scrollTo: null,
  ignorePop: false,
  collapsingId: null,
  comboCount: 0,
  lastCheckAt: 0,
  todayCompact: false,
  penaltyWindow: null,
  shopCat: "themes",
};
let levelTimer = 0;
let genToken = 0;
let todayScrollBound = false;

function tabFromHash() {
  const tab = location.hash.replace("#", "");
  return TABS.includes(tab) ? tab : "today";
}

function setHash(tab) {
  if (location.hash !== `#${tab}`) history.replaceState(history.state, "", `#${tab}`);
}

function assign(obj, path, value) {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (cursor[key] == null) return;
    cursor = cursor[key];
  }
  const last = parts[parts.length - 1];
  cursor[/^\d+$/.test(last) ? Number(last) : last] = value;
}

function scrape() {
  if (!ui.draft) return;
  document.querySelectorAll("[data-bind]").forEach((el) => {
    if (el.dataset.commit === "settings") return;
    const value = el.type === "checkbox" ? el.checked : el.value;
    assign(ui.draft, el.dataset.bind, value);
  });
  const copyChecks = document.querySelectorAll("[data-copy-target]");
  if (copyChecks.length && Array.isArray(ui.draft.targets)) {
    ui.draft.targets = [...copyChecks]
      .filter((el) => el.checked)
      .map((el) => el.dataset.copyTarget);
  }
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function currentListScope() {
  return `${ui.tab}|${ui.lookDate || ""}|${ui.weekMode}|${ui.selectedDate || ""}|${ui.selectedWeekday || ""}|${ui.calDate || ""}`;
}

function stageClosingNode(node, durationMs = 190) {
  if (!node) return;
  const fxRoot = document.getElementById("fx");
  if (!fxRoot) return;
  node.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  if (node.id) node.removeAttribute("id");
  node.inert = true;
  node.setAttribute("aria-hidden", "true");
  node.classList.remove("is-steady");
  node.classList.add("is-closing");
  fxRoot.appendChild(node);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    node.remove();
  };
  node.addEventListener("animationend", (event) => {
    if (event.target === node) cleanup();
  });
  setTimeout(cleanup, durationMs + 60);
}

function paint() {
  const reduced = prefersReducedMotion();
  const active = document.activeElement;
  const activeId = active?.id || "";
  const selStart = active?.selectionStart;
  const selEnd = active?.selectionEnd;
  const appEl = document.getElementById("app");
  const scrolling = document.getElementById("main");
  const scroll = ui.keepScroll ? scrolling?.scrollTop || 0 : 0;
  const prevBar = appEl.querySelector("[data-bar]")?.dataset.pct || null;
  const prevRing = appEl.querySelector("[data-ring]")?.style.strokeDashoffset || null;

  const existingScrim = appEl.querySelector(".scrim");
  const existingSheet = appEl.querySelector(".sheet");
  const existingConfirm = appEl.querySelector(".confirm");
  const existingLevelup = appEl.querySelector(".levelup");
  const wasSheetOpen = Boolean(existingSheet);
  const wasConfirmOpen = Boolean(existingConfirm);
  const wasLevelupOpen = Boolean(existingLevelup);

  const nextScope = currentListScope();
  const canFlip = !reduced && !ui.enter && prevListScope === nextScope && Boolean(scrolling);
  let firstTops = null;
  if (canFlip) {
    firstTops = new Map();
    scrolling.querySelectorAll("[data-row-id]").forEach((row) => {
      firstTops.set(row.dataset.rowId, row.getBoundingClientRect().top);
    });
  }
  prevListScope = nextScope;

  if (!reduced) {
    if (wasSheetOpen && !ui.sheet) {
      stageClosingNode(existingScrim, 180);
      stageClosingNode(existingSheet, 190);
    }
    if (wasConfirmOpen && !ui.confirm) stageClosingNode(existingConfirm, 160);
    if (wasLevelupOpen && !ui.levelUp) stageClosingNode(existingLevelup, 170);
  }

  const nextTheme = state.settings?.theme || "ember";
  if (nextTheme !== appliedTheme) {
    appliedTheme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_BG[nextTheme] || "#100e0c");
  }

  try {
    appEl.innerHTML = render(state, ui, new Date());
  } catch (error) {
    console.error(error);
    appEl.innerHTML = shellError(error.message || "Something broke while drawing Ember.");
    return;
  }

  if (wasSheetOpen && ui.sheet) {
    appEl.querySelector(".scrim")?.classList.add("is-steady");
    appEl.querySelector(".sheet")?.classList.add("is-steady");
  }
  if (wasConfirmOpen && ui.confirm) appEl.querySelector(".confirm-card")?.classList.add("is-steady");
  if (wasLevelupOpen && ui.levelUp) appEl.querySelector(".levelup-card")?.classList.add("is-steady");

  const nextMain = document.getElementById("main");
  if (nextMain && ui.keepScroll) nextMain.scrollTop = scroll;

  const barEl = appEl.querySelector("[data-bar]");
  const ringEl = appEl.querySelector("[data-ring]");
  const movedRows = [];

  if (firstTops && nextMain) {
    const rows = [...nextMain.querySelectorAll("[data-row-id]")];
    const measured = rows.map((row) => {
      const id = row.dataset.rowId;
      const prevTop = firstTops.get(id);
      if (prevTop == null) return { row, added: firstTops.size > 0, dy: 0 };
      return { row, added: false, dy: prevTop - row.getBoundingClientRect().top };
    });
    for (const item of measured) {
      if (item.added) {
        item.row.classList.add("quest-enter");
      } else if (Math.abs(item.dy) > 1 && Math.abs(item.dy) < 640) {
        item.row.style.transition = "none";
        item.row.style.willChange = "transform";
        item.row.style.transform = `translate3d(0, ${Math.round(item.dy)}px, 0)`;
        movedRows.push(item.row);
      }
    }
  }

  const nextBar = barEl?.dataset.pct || null;
  const animateBar = !reduced && Boolean(barEl && prevBar != null && nextBar && prevBar !== nextBar);
  if (animateBar) {
    barEl.style.transition = "none";
    barEl.style.transform = `scaleX(${prevBar})`;
  }

  const nextRing = ringEl?.style.strokeDashoffset || null;
  const animateRing = !reduced && Boolean(ringEl && prevRing != null && nextRing && prevRing !== nextRing);
  if (animateRing) {
    ringEl.style.transition = "none";
    ringEl.style.strokeDashoffset = prevRing;
  }

  if (movedRows.length || animateBar || animateRing) {
    requestAnimationFrame(() => {
      for (const row of movedRows) {
        row.style.transition = "transform 200ms var(--ease)";
        row.style.transform = "translate3d(0, 0, 0)";
        const clearFlip = () => {
          row.style.transition = "";
          row.style.transform = "";
          row.style.willChange = "";
        };
        row.addEventListener("transitionend", clearFlip, { once: true });
        setTimeout(clearFlip, 240);
      }
      if (animateBar && barEl) {
        barEl.style.transition = "";
        barEl.style.transform = `scaleX(${nextBar})`;
      }
      if (animateRing && ringEl) {
        ringEl.style.transition = "";
        ringEl.style.strokeDashoffset = nextRing;
      }
    });
  }

  if (ui.scrollTo) {
    document.getElementById(ui.scrollTo)?.scrollIntoView({ block: "start" });
    ui.scrollTo = null;
  }
  if (ui.focusSheet) {
    appEl.querySelector(".sheet input, .sheet textarea")?.focus();
    ui.focusSheet = false;
  } else if (activeId) {
    const next = document.getElementById(activeId);
    if (next) {
      next.focus();
      if (selStart != null && next.setSelectionRange) {
        try {
          next.setSelectionRange(selStart, selEnd);
        } catch {
          /* time and date inputs don't take a selection */
        }
      }
    }
  }
  ui.enter = false;
  updateBadge();
  bindTodayScroll();
}

function bindTodayScroll() {
  if (ui.tab !== "today") return;
  const main = document.getElementById("main");
  if (!main || todayScrollBound) return;
  todayScrollBound = true;
  main.addEventListener(
    "scroll",
    () => {
      const compact = main.scrollTop > 72;
      if (compact === ui.todayCompact) return;
      ui.todayCompact = compact;
      document.getElementById("today-sticky")?.classList.toggle("is-compact", compact);
    },
    { passive: true },
  );
}

function soundOpts() {
  return {
    volume: state.settings?.soundVolume ?? 0.72,
    pack: state.settings?.soundPack || "system",
  };
}

function sfx(kind) {
  if (!state.settings?.sound) return;
  playSound(kind, soundOpts());
}

function toast(text) {
  if (!text) return;
  const root = document.getElementById("fx");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  root.appendChild(el);
  const live = document.getElementById("live");
  if (live) live.textContent = text;
  setTimeout(() => el.remove(), 2600);
}

function floater(text, x, y, kind) {
  const el = document.createElement("div");
  el.className = `floater ${kind || "xp"}`;
  el.textContent = text;
  el.style.setProperty("--fx-x", `${Math.round(x)}px`);
  el.style.setProperty("--fx-y", `${Math.round(y)}px`);
  document.getElementById("fx").appendChild(el);
  const live = document.getElementById("live");
  if (live) live.textContent = text;
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 600);
}

function haptic(kind) {
  if (!state.settings?.haptics || !navigator.vibrate) return;
  const pattern = {
    tick: [12],
    down: [8],
    level: [18, 36, 20, 48, 28],
    warn: [22, 36, 22],
    combo: [8, 14, 22],
    day: [16, 28, 16, 40],
  };
  navigator.vibrate(pattern[kind] || [12]);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateBadge() {
  if (!navigator.setAppBadge) return;
  const left = openTodayCount(state, dateKey(new Date()));
  const pending = left ? navigator.setAppBadge(left) : navigator.clearAppBadge();
  pending.catch(() => {});
}

function openSheet(sheet, draft) {
  ui.sheet = sheet;
  ui.draft = draft;
  ui.focusSheet = true;
  ui.keepScroll = true;
  if (!history.state?.sheet) history.pushState({ sheet: true }, "");
  paint();
}

function closeSheet() {
  genToken += 1;
  ui.sheet = null;
  ui.draft = null;
  ui.keepScroll = true;
  paint();
  if (history.state?.sheet) {
    ui.ignorePop = true;
    history.back();
  }
}

async function commitWrapped(mutator, fx = {}) {
  const prevXp = totalXp(state);
  const prevLevel = levelFor(prevXp);
  const logBefore = state.crystalLog.length;
  const beforeCrystals = state.crystals;
  state = mutator(state);
  const prepared = prepare(state, new Date());
  state = prepared.state;
  ensureRivalHistory(state, prepared.today);
  if (ui.exercise && !exerciseGroups(state).some((group) => group.key === ui.exercise)) ui.exercise = null;
  if (fx.close) {
    genToken += 1;
    ui.sheet = null;
    ui.draft = null;
  }
  const saving = saveState(state);
  const level = levelFor(totalXp(state));
  ui.barPulse = totalXp(state) > prevXp;
  ui.gemShine = state.crystals > beforeCrystals;
  ui.ringPulse = Boolean(fx.ring);
  ui.keepScroll = fx.keepScroll !== false;
  paint();
  ui.barPulse = false;
  ui.gemShine = false;
  ui.ringPulse = false;
  ui.justDoneId = null;
  if (fx.pop) {
    floater(fx.pop.text, fx.pop.x, fx.pop.y, fx.pop.kind);
    sfx(fx.pop.kind === "down" ? "down" : "tick");
    haptic(fx.pop.kind === "down" ? "down" : "tick");
  }
  try {
    await saving;
  } catch (error) {
    toast(error.message || "Couldn't save on this phone.");
  }
  if (fx.close && history.state?.sheet) {
    ui.ignorePop = true;
    history.back();
  }
  const fresh = state.crystalLog.slice(0, Math.max(0, state.crystalLog.length - logBefore));
  const messages = [];
  if (!fx.quiet) {
    const notes = fresh.filter((entry) => entry.delta > 0 && entry.reason !== "level");
    if (notes.length) messages.push(notes.map((entry) => `+${entry.delta} · ${reasonLabel(entry.reason)}`).join("  "));
  }
  if (messages.length) toast(messages.join("  "));
  if (level > prevLevel) {
    const paid = fresh.filter((entry) => entry.reason === "level" && entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0);
    clearTimeout(levelTimer);
    levelTimer = setTimeout(() => {
      ui.levelUp = { level, crystals: paid };
      ui.keepScroll = true;
      ui.enter = false;
      paint();
      sfx("level");
      haptic("level");
    }, 740);
  }
  syncReminderSchedule(state).catch(() => {});
  if (!fx.skipDriveSchedule) driveScheduler.noteChange();
}

const commitAction = commitWrapped;

function pointOf(el) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + 6 };
}

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    ui.enter = true;
    ui.keepScroll = false;
    ui.exercise = null;
    ui.reordering = false;
    setHash(ui.tab);
    if (ui.tab === "you" || ui.tab === "settings") refreshNotify().then(() => paint());
    if (ui.tab !== "today") todayScrollBound = false;
    paint();
  },
  "toggle-reorder"() {
    ui.reordering = !ui.reordering;
    ui.keepScroll = true;
    haptic("tick");
    paint();
  },
  async "step-quest"(el) {
    haptic("tick");
    const dir = Number(el.dataset.dir);
    const isTemplate = el.dataset.template === "true" || Boolean(el.dataset.weekday);
    await commitAction(
      (current) => (
        isTemplate
          ? stepTemplateTask(current, el.dataset.weekday, el.dataset.slot, el.dataset.id, dir)
          : stepTask(current, el.dataset.date, el.dataset.slot, el.dataset.id, dir, new Date())
      ),
      { quiet: true },
    );
  },
  "goto-shop"() {
    ui.tab = "you";
    ui.scrollTo = "shop";
    ui.enter = true;
    ui.keepScroll = false;
    setHash("you");
    paint();
  },
  async toggle(el) {
    const done = el.getAttribute("aria-pressed") !== "true";
    const at = pointOf(el);
    const date = el.dataset.date;
    const taskId = el.dataset.id;
    const wasDayComplete = isComplete(state, date);
    const reduced = prefersReducedMotion();
    ui.justDoneId = taskId;
    if (done) {
      const now = Date.now();
      ui.comboCount = now - (ui.lastCheckAt || 0) < 4000 ? Math.min(9, (ui.comboCount || 0) + 1) : 1;
      ui.lastCheckAt = now;
    } else {
      ui.comboCount = 0;
    }
    await commitAction(
      (current) => setTaskDone(current, el.dataset.date, el.dataset.slot, taskId, done, new Date()),
      {
        pop: {
          text: done
            ? ui.comboCount >= 2
              ? `+25 XP · ×${ui.comboCount}`
              : "+25 XP"
            : "−25 XP",
          ...at,
          kind: done ? "xp" : "down",
        },
        ring: true,
      },
    );
    if (done) {
      const fxPack = state.settings?.checkFx || "shards";
      if (fxPack === "shards") shardBurstToCrystal(at.x, at.y, reduced);
      else burstAt(at.x, at.y, reduced);
      if (ui.comboCount >= 2) {
        sfx("combo");
        haptic("combo");
      }
      if (!ui.reordering) {
        ui.collapsingId = taskId;
        ui.keepScroll = true;
        paint();
        if (!reduced) {
          await waitMs(160);
          const row = document.querySelector(`[data-row-id="${taskId}"]`);
          row?.classList.add("is-collapsing");
          await waitMs(220);
        }
        ui.collapsingId = null;
        ui.keepScroll = true;
        paint();
      }
      if (!wasDayComplete && isComplete(state, date)) {
        dailyCompleteBanner(reduced);
        confettiFan(reduced);
        haptic("day");
        toast("Day complete — every quest done.");
      }
    }
  },
  "toggle-done-drawer"(el) {
    const key = el.dataset.doneKey;
    if (!key) return;
    const open = state.settings?.doneSlotsOpen || {};
    const next = { ...open };
    if (next[key]) delete next[key];
    else next[key] = true;
    haptic("tick");
    commitAction((current) => patchSettings(current, { doneSlotsOpen: next }), { quiet: true });
  },
  "shift-day"(el) {
    const today = dateKey(new Date());
    const current = ui.lookDate || today;
    const next = addDays(current, Number(el.dataset.dir));
    if (next > today || next < addDays(today, -120)) return;
    ui.lookDate = next === today ? null : next;
    ui.enter = true;
    ui.keepScroll = false;
    paint();
  },
  "jump-today"() {
    ui.lookDate = null;
    ui.enter = true;
    ui.keepScroll = false;
    paint();
  },
  "add-task"(el) {
    openSheet(
      { type: "task", date: el.dataset.date, slot: el.dataset.slot, taskId: null },
      { title: "", why: "", time: "", slot: el.dataset.slot, isEvent: false, saveTemplate: false, error: "" },
    );
  },
  "add-event"(el) {
    openSheet(
      { type: "task", date: el.dataset.date, slot: el.dataset.slot, taskId: null },
      { title: "", why: "", time: "", slot: el.dataset.slot, isEvent: true, saveTemplate: false, error: "" },
    );
  },
  "edit-task"(el) {
    const task = state.days[el.dataset.date]?.slots?.[el.dataset.slot]?.find((item) => item.id === el.dataset.id);
    if (!task) return;
    openSheet(
      { type: "task", date: el.dataset.date, slot: el.dataset.slot, taskId: task.id },
      { title: task.title, why: task.why, time: task.time, slot: el.dataset.slot, isEvent: Boolean(task.isEvent), error: "" },
    );
  },
  "add-template"(el) {
    openSheet(
      { type: "template", weekday: el.dataset.weekday, slot: el.dataset.slot, taskId: null },
      { title: "", why: "", time: "", slot: el.dataset.slot, error: "" },
    );
  },
  "edit-template"(el) {
    const task = state.template[el.dataset.weekday]?.[el.dataset.slot]?.find((item) => item.id === el.dataset.id);
    if (!task) return;
    openSheet(
      { type: "template", weekday: el.dataset.weekday, slot: el.dataset.slot, taskId: task.id },
      { title: task.title, why: task.why, time: task.time, slot: el.dataset.slot, error: "" },
    );
  },
  "set-slot"(el) {
    ui.draft.slot = el.dataset.slot;
    ui.keepScroll = true;
    paint();
  },
  async "save-task"() {
    if (!(ui.draft?.title || "").trim()) {
      ui.draft.error = "Give the quest a name.";
      ui.keepScroll = true;
      paint();
      return;
    }
    const sheet = ui.sheet;
    const draft = { ...ui.draft, slot: ui.draft.slot || sheet.slot };
    const now = new Date();
    await commitAction((current) => {
      if (sheet.type === "template") {
        return sheet.taskId
          ? updateTemplateTask(current, sheet.weekday, sheet.slot, sheet.taskId, draft)
          : addTemplateTask(current, sheet.weekday, draft.slot, draft);
      }
      return sheet.taskId
        ? updateTask(current, sheet.date, sheet.slot, sheet.taskId, draft, now)
        : addTask(current, sheet.date, draft.slot, draft, now);
    }, { close: true });
  },
  async "delete-task"() {
    const sheet = ui.sheet;
    if (!sheet?.taskId) return;
    await commitAction((current) => (
      sheet.type === "template"
        ? deleteTemplateTask(current, sheet.weekday, sheet.slot, sheet.taskId)
        : deleteTask(current, sheet.date, sheet.slot, sheet.taskId, new Date())
    ), { close: true, ring: true });
  },
  "close-sheet"() {
    closeSheet();
  },
  "select-date"(el) {
    ui.selectedDate = el.dataset.date;
    ui.selectedWeekday = null;
    ui.keepScroll = true;
    paint();
  },
  "select-weekday"(el) {
    ui.selectedWeekday = el.dataset.weekday;
    ui.keepScroll = true;
    paint();
  },
  "week-mode"(el) {
    if (ui.weekMode === el.dataset.mode) return;
    ui.weekMode = el.dataset.mode;
    if (ui.weekMode === "calendar") {
      const today = dateKey(new Date());
      if (!ui.calDate) ui.calDate = today;
      if (!ui.calMonth) ui.calMonth = monthKey(ui.calDate);
    }
    ui.enter = true;
    ui.keepScroll = false;
    paint();
  },
  "shift-month"(el) {
    const today = dateKey(new Date());
    const current = ui.calMonth || monthKey(ui.calDate || today);
    ui.calMonth = addMonths(current, Number(el.dataset.dir));
    ui.keepScroll = true;
    paint();
  },
  "cal-select-date"(el) {
    const picked = el.dataset.date;
    if (!picked) return;
    ui.calDate = picked;
    ui.calMonth = monthKey(picked);
    ui.keepScroll = true;
    paint();
  },
  "cal-today"() {
    const today = dateKey(new Date());
    ui.calDate = today;
    ui.calMonth = monthKey(today);
    ui.keepScroll = true;
    paint();
  },
  "open-copy-day"(el) {
    const kind = el.dataset.kind === "template" ? "template" : "week";
    ui.sheet = {
      type: "copy-day",
      kind,
      date: el.dataset.date || "",
      weekday: el.dataset.weekday || "",
    };
    ui.draft = { copyMode: "replace", targets: [], error: "" };
    ui.focusSheet = false;
    ui.keepScroll = true;
    if (!history.state?.sheet) history.pushState({ sheet: true }, "");
    paint();
  },
  "set-copy-mode"(el) {
    if (!ui.draft) return;
    ui.draft.copyMode = el.dataset.copyMode === "append" ? "append" : "replace";
    ui.draft.error = "";
    ui.keepScroll = true;
    paint();
  },
  "copy-select-all"() {
    if (!ui.draft || ui.sheet?.type !== "copy-day") return;
    const allTargets = copyTargetOptions(ui.sheet);
    const current = new Set((ui.draft.targets || []).map(String));
    const allChecked = allTargets.length > 0 && allTargets.every((val) => current.has(val));
    ui.draft.targets = allChecked ? [] : allTargets;
    ui.draft.error = "";
    ui.keepScroll = true;
    paint();
  },
  async "save-copy-day"() {
    if (!ui.draft || ui.sheet?.type !== "copy-day") return;
    const targets = [...new Set((ui.draft.targets || []).map(String))];
    if (!targets.length) {
      ui.draft.error = "Choose at least one day.";
      ui.keepScroll = true;
      paint();
      return;
    }
    const mode = ui.draft.copyMode === "append" ? "append" : "replace";
    if (mode === "replace") {
      const occupied = occupiedCopyTargets(state, ui.sheet.kind, targets);
      if (occupied.length > 0) {
        ui.confirm = {
          title: "Replace existing quests?",
          body: `${occupied.length === 1 ? "1 selected day already has quests" : `${occupied.length} selected days already have quests`} and will be overwritten.`,
          label: "Replace",
          action: "confirm-copy-day",
        };
        ui.keepScroll = true;
        paint();
        return;
      }
    }
    await runCopyDay();
  },
  async "save-weekday"(el) {
    await commitAction((current) => copyDayToTemplate(current, el.dataset.date));
    toast(`Saved ${formatPretty(el.dataset.date)} onto the template.`);
  },
  async "apply-template"() {
    let filled = 0;
    await commitAction((current) => {
      const result = applyTemplateToOpenDays(current, dateKey(new Date()), new Date());
      filled = result.filled;
      return result.state;
    });
    toast(filled ? `Filled ${filled} open day${filled === 1 ? "" : "s"}.` : "Every day this week is already started.");
  },
  async "use-template-day"(el) {
    await commitAction((current) => replaceDayFromTemplate(current, el.dataset.date, new Date()), { ring: true });
  },
  "open-generate"() {
    openSheet(
      { type: "generate" },
      { goals: state.settings.goals, key: state.settings.geminiApiKey, error: "", loading: false, preview: null },
    );
  },
  async "run-generate"() {
    const token = ++genToken;
    ui.draft.loading = true;
    ui.draft.error = "";
    ui.keepScroll = true;
    paint();
    try {
      const plan = await generateWeek(ui.draft.key, ui.draft.goals, AbortSignal.timeout(35000));
      if (token !== genToken || !ui.draft) return;
      ui.draft.preview = plan;
      ui.draft.loading = false;
      await commitAction((current) => patchSettings(current, {
        goals: ui.draft.goals,
        geminiApiKey: ui.draft.key,
        geminiKeyStatus: ui.draft.key ? "ok" : current.settings.geminiKeyStatus,
      }), { quiet: true });
    } catch (error) {
      if (token !== genToken || !ui.draft) return;
      ui.draft.loading = false;
      ui.draft.error = error.message || "Gemini didn't answer.";
      ui.keepScroll = true;
      paint();
    }
  },
  async "apply-generate"() {
    const plan = ui.draft?.preview;
    if (!plan) return;
    let filled = 0;
    await commitAction((current) => {
      const result = applyGeneratedPlan(current, plan, dateKey(new Date()), new Date());
      filled = result.filled;
      return result.state;
    }, { close: true });
    toast(filled ? `Applied to ${filled} open day${filled === 1 ? "" : "s"}.` : "The template updated. Started days were left alone.");
  },
  "open-workout"() {
    openSheet(
      { type: "workout" },
      { name: "", kind: "strength", date: dateKey(new Date()), sets: [{ reps: "", weight: "" }], minutes: "", km: "", notes: "", error: "" },
    );
  },
  "set-kind"(el) {
    ui.draft.kind = el.dataset.kind;
    ui.keepScroll = true;
    paint();
  },
  "add-set"() {
    ui.draft.sets.push({ reps: "", weight: "" });
    ui.keepScroll = true;
    paint();
  },
  "remove-set"(el) {
    if ((ui.draft.sets || []).length < 2) return;
    ui.draft.sets.splice(Number(el.dataset.index), 1);
    ui.keepScroll = true;
    paint();
  },
  async "save-workout"() {
    const parsed = readWorkout(ui.draft);
    if (parsed.error) {
      ui.draft.error = parsed.error;
      ui.keepScroll = true;
      paint();
      return;
    }
    const button = document.querySelector('.sheet button[type="submit"]');
    const at = button ? pointOf(button) : { x: window.innerWidth / 2, y: window.innerHeight * 0.7 };
    await commitAction((current) => addWorkout(current, parsed, new Date()), {
      close: true,
      pop: { text: "+40 XP", ...at, kind: "xp" },
    });
  },
  "open-exercise"(el) {
    ui.exercise = el.dataset.name;
    ui.keepScroll = false;
    ui.enter = true;
    paint();
  },
  "close-exercise"() {
    ui.exercise = null;
    ui.enter = true;
    ui.keepScroll = false;
    paint();
  },
  "delete-workout"(el) {
    ui.confirm = {
      title: "Delete this session?",
      body: "The 40 XP comes off with it.",
      label: "Delete",
      action: "delete-workout",
      id: el.dataset.id,
    };
    paint();
  },
  "dismiss-hint"() {
    commitAction((current) => patchSettings(current, { dismissedHint: true }), { quiet: true });
  },
  "dismiss-levelup"() {
    ui.levelUp = null;
    ui.keepScroll = true;
    paint();
  },
  "ask-buy-theme"(el) {
    const theme = THEMES.find((item) => item.id === el.dataset.theme);
    if (!theme) return;
    ui.confirm = {
      title: `Get ${theme.name}?`,
      body: `Spend ${theme.price} crystals. You can switch back whenever you want.`,
      label: "Spend",
      action: "buy-theme",
      theme: theme.id,
    };
    paint();
  },
  "shop-cat"(el) {
    ui.shopCat = el.dataset.cat || "themes";
    ui.keepScroll = true;
    paint();
  },
  "ask-buy-item"(el) {
    const item = SHOP_CATALOG.find((entry) => entry.id === el.dataset.item);
    if (!item) return;
    ui.confirm = {
      title: `Get ${item.name}?`,
      body: `Spend ${item.price} crystals.`,
      label: "Spend",
      action: "buy-item",
      item: item.id,
    };
    paint();
  },
  "equip-cosmetic"(el) {
    const kind = el.dataset.kind;
    const value = el.dataset.value;
    const patch =
      kind === "skin"
        ? { crystalSkin: value }
        : kind === "title"
          ? { equippedTitle: value }
          : kind === "fx"
            ? { checkFx: value }
            : kind === "soundPack"
              ? { soundPack: value }
              : {};
    commitAction((current) => equipCosmetic(current, patch), { quiet: true });
  },
  async "dismiss-penalty"() {
    ui.penaltyWindow = null;
    await commitAction((current) => acknowledgePenalty(current), { quiet: true });
    paint();
  },
  "sound-volume"(el) {
    const vol = Math.max(0, Math.min(1, Number(el.value) / 100));
    commitAction((current) => patchSettings(current, { soundVolume: vol }), { quiet: true });
    sfx("tick");
  },
  async "add-life-reward"() {
    const title = window.prompt("Life reward (e.g. 30 min gaming)");
    if (!title?.trim()) return;
    const priceRaw = window.prompt("Crystal price", "20");
    const price = Number(priceRaw) || 20;
    await commitAction(
      (current) => {
        const result = addCustomReward(current, { title: title.trim(), price }, new Date());
        return result.ok ? result.state : current;
      },
      { quiet: true },
    );
    ui.shopCat = "life";
    ui.keepScroll = true;
    toast("Life reward added.");
    paint();
  },
  "redeem-life"(el) {
    commitAction((current) => {
      const result = redeemCustomReward(current, el.dataset.reward, new Date());
      return result.ok ? result.state : current;
    });
    toast("Redeemed. Go enjoy it.");
  },
  "equip-theme"(el) {
    commitAction((current) => equipTheme(current, el.dataset.theme), { quiet: true });
  },
  async "toggle-setting"(el) {
    const key = el.dataset.key;
    await commitAction((current) => {
      const prev = key === "driveAutoBackup"
        ? current.settings.driveAutoBackup !== false
        : Boolean(current.settings[key]);
      return patchSettings(current, { [key]: !prev });
    }, { quiet: true });
    if (key === "driveAutoBackup") driveScheduler.recheck();
  },
  "toggle-reveal"() {
    const input = document.getElementById("gemini-key");
    if (input) ui.geminiDraft = input.value;
    ui.revealKey = !ui.revealKey;
    ui.keepScroll = true;
    paint();
  },
  "replace-gemini"() {
    ui.editingGemini = true;
    ui.geminiDraft = state.settings.geminiApiKey || "";
    ui.geminiError = "";
    ui.revealKey = false;
    ui.keepScroll = true;
    paint();
  },
  "ask-remove-gemini"() {
    ui.confirm = {
      title: "Remove the Gemini key?",
      body: "Week generation turns off until you paste a key again. Quests you already have stay.",
      label: "Remove",
      action: "remove-gemini",
    };
    paint();
  },
  async "save-gemini"() {
    const input = document.getElementById("gemini-key");
    const key = (input?.value ?? ui.geminiDraft ?? "").trim();
    const current = state.settings.geminiApiKey || "";
    if (!key || key === current) return;
    ui.geminiDraft = key;
    ui.geminiBusy = true;
    ui.geminiError = "";
    ui.keepScroll = true;
    paint();
    const result = await checkGeminiKey(key);
    if (result.action === "reject") {
      ui.geminiBusy = false;
      ui.geminiError = result.message;
      ui.keepScroll = true;
      paint();
      return;
    }
    await commitAction((currentState) => patchSettings(currentState, {
      geminiApiKey: key,
      geminiKeyStatus: result.status,
    }), { quiet: true });
    ui.geminiBusy = false;
    ui.editingGemini = false;
    ui.geminiDraft = "";
    ui.geminiError = "";
    ui.keepScroll = true;
    paint();
  },
  async "drive-backup"() {
    if (!GOOGLE_CLIENT_ID) return;
    try {
      ui.driveStatus = "Backing up…";
      paint();
      await backupToDrive({ silent: false });
      toast("Backed up to Google Drive.");
    } catch (error) {
      ui.driveStatus = "";
      toast(error.message || "Drive backup didn't finish.");
      paint();
    }
  },
  async "drive-reconnect"() {
    if (!GOOGLE_CLIENT_ID) return;
    try {
      ui.driveStatus = "Reconnecting…";
      paint();
      await backupToDrive({ silent: false });
      toast("Drive reconnected and backed up.");
    } catch (error) {
      ui.driveStatus = "";
      toast(error.message || "Couldn't reconnect Drive.");
      paint();
    }
  },
  async "drive-restore"() {
    if (!GOOGLE_CLIENT_ID) return;
    try {
      let access = await requestDriveToken(state.settings.driveLinked ? "" : "consent");
      let files;
      try {
        files = await listBackups(access);
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          await clearDriveToken();
          access = await requestDriveToken("");
          files = await listBackups(access);
        } else {
          throw error;
        }
      }
      ui.driveNeedsReconnect = false;
      ui.driveFiles = files;
      ui.sheet = { type: "drive" };
      ui.focusSheet = false;
      ui.keepScroll = true;
      if (!history.state?.sheet) history.pushState({ sheet: true }, "");
      paint();
    } catch (error) {
      toast(error.message || "Couldn't open Drive.");
    }
  },
  "drive-pick"(el) {
    const file = (ui.driveFiles || []).find((item) => item.id === el.dataset.id);
    ui.confirm = {
      title: "Restore this backup?",
      body: "Quests, XP, and workouts on this phone will be replaced. Your Gemini key stays if this backup doesn't include one.",
      label: "Restore",
      action: "drive-restore-file",
      id: el.dataset.id,
      name: file?.name || "Backup",
    };
    paint();
  },
  async "push-on"() {
    try {
      await enableClosedReminders(state);
      await commitAction((current) => patchSettings(current, { pushOn: true }), { quiet: true });
      toast("Closed-app reminders are on.");
    } catch (error) {
      toast(error.message || "Couldn't turn on closed-app reminders.");
    }
  },
  async "push-off"() {
    await disableClosedReminders(state);
    await commitAction((current) => patchSettings(current, { pushOn: false }), { quiet: true });
    toast("Closed-app reminders are off. Open-app reminders still work.");
  },
  "confirm-no"() {
    ui.confirm = null;
    ui.pendingImport = null;
    ui.keepScroll = true;
    paint();
  },
  async "confirm-yes"() {
    const confirm = ui.confirm;
    if (!confirm) return;
    ui.confirm = null;
    if (confirm.action === "buy-theme") {
      await commitAction((current) => {
        const result = buyTheme(current, confirm.theme, new Date());
        return result.ok ? result.state : current;
      }, { quiet: true });
      toast("Theme equipped.");
      return;
    }
    if (confirm.action === "buy-item") {
      await commitAction((current) => {
        const result = buyItem(current, confirm.item, new Date());
        return result.ok ? result.state : current;
      }, { quiet: true });
      toast("Unlocked.");
      return;
    }
    if (confirm.action === "delete-workout") {
      await commitAction((current) => deleteWorkout(current, confirm.id, new Date()), {
        pop: { text: "−40 XP", x: window.innerWidth / 2, y: 180, kind: "down" },
      });
      return;
    }
    if (confirm.action === "confirm-copy-day") {
      await runCopyDay();
      return;
    }
    if (confirm.action === "import" && ui.pendingImport) {
      await applyRestoredState(ui.pendingImport);
      return;
    }
    if (confirm.action === "remove-gemini") {
      await commitAction((current) => patchSettings(current, { geminiApiKey: "", geminiKeyStatus: "" }), { quiet: true });
      ui.editingGemini = false;
      ui.geminiDraft = "";
      ui.geminiError = "";
      toast("Gemini key removed.");
      return;
    }
    if (confirm.action === "drive-restore-file") {
      try {
        const access = await requestDriveToken("");
        const raw = await downloadBackup(access, confirm.id);
        const imported = restoreKeepingSecrets(sanitizeImport(raw, state), state);
        await applyRestoredState(imported, { fromDrive: true });
      } catch (error) {
        toast(error.message || "Couldn't restore that backup.");
      }
      return;
    }
    if (confirm.action === "reset") {
      try {
        await kvClear();
      } catch {
        /* mirror still clears */
      }
      try {
        localStorage.removeItem("ember-state");
      } catch {
        /* ignore */
      }
      const prepared = prepare(createInitialState(new Date()), new Date());
      state = prepared.state;
      ensureRivalHistory(state, prepared.today);
      await saveState(state);
      ui.tab = "today";
      ui.lookDate = null;
      ui.calDate = null;
      ui.calMonth = null;
      ui.exercise = null;
      setHash("today");
      paint();
      toast("Ember is empty again.");
      syncReminderSchedule(state).catch(() => {});
    }
  },
  "ask-reset"() {
    ui.confirm = {
      title: "Erase Ember on this phone?",
      body: "Quests, XP, workouts, crystals, and the Gemini key go with it. Export a backup first if you want one.",
      label: "Erase",
      action: "reset",
    };
    paint();
  },
  async export() {
    await flushSettingsInputs();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ember-backup-${dateKey(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  import() {
    const input = ensureBackupInput();
    input.value = "";
    input.click();
  },
  async "enable-notify"() {
    const result = await enableNotifications();
    await refreshNotify();
    if (!result.ok) toast(result.reason);
    else {
      toast("Reminders can fire while Ember is open.");
      syncReminderSchedule(state).catch(() => {});
    }
    paint();
  },
  async install() {
    if (!ui.installEvent) return;
    ui.installEvent.prompt();
    await ui.installEvent.userChoice.catch(() => {});
    ui.installEvent = null;
    paint();
  },
};

function readWorkout(draft) {
  const kind = draft.kind === "cardio" ? "cardio" : "strength";
  const name = (draft.name || "").trim();
  if (!name) return { error: "Name the exercise." };
  const date = draft.date || dateKey(new Date());
  if (kind === "cardio") {
    const durationMin = parseNum(draft.minutes) || 0;
    const distanceKm = parseNum(draft.km) || 0;
    if (durationMin <= 0 && distanceKm <= 0) return { error: "Add minutes, kilometres, or both." };
    return { name, kind, date, durationMin, distanceKm, notes: draft.notes || "", sets: [] };
  }
  const sets = (draft.sets || [])
    .map((set) => ({ reps: parseNum(set.reps), weightKg: parseNum(set.weight) ?? 0 }))
    .filter((set) => set.reps > 0);
  if (!sets.length) return { error: "Add at least one set with reps. Weight can be 0." };
  return { name, kind, date, sets, notes: draft.notes || "" };
}

async function refreshNotify() {
  ui.notifyState = globalThis.Notification?.permission || "unsupported";
  ui.periodic = await periodicStatus();
}

function readFileAsText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

function ensureBackupInput() {
  let input = document.getElementById("backup-file");
  if (!input) {
    input = document.createElement("input");
    input.id = "backup-file";
    input.type = "file";
    input.accept = ".json,application/json,text/plain";
    input.className = "sr";
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    document.body.appendChild(input);
  }
  if (!input._emberBound) {
    input._emberBound = true;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const raw = parseBackupText(text);
        const imported = sanitizeImport(raw, state);
        const { quests, workouts, level } = summarizeBackup(imported);
        ui.pendingImport = imported;
        ui.confirm = {
          title: "Replace this phone’s data?",
          body: `Found ${quests} quest${quests === 1 ? "" : "s"}, ${workouts} workout${workouts === 1 ? "" : "s"}, level ${level}. Quests, XP, workouts, crystals, and themes on this phone will be replaced.`,
          label: "Import",
          action: "import",
        };
        paint();
      } catch (error) {
        ui.pendingImport = null;
        toast(error.message || "Couldn't read that file.");
      }
    });
  }
  return input;
}

async function flushSettingsInputs() {
  const patch = {};
  let dirty = false;
  document.querySelectorAll('[data-commit="settings"][data-bind]').forEach((el) => {
    clearTimeout(el._emberTimer);
    const key = el.dataset.bind;
    if (state.settings && state.settings[key] !== el.value) {
      patch[key] = el.value;
      dirty = true;
    }
  });
  if (dirty) {
    state = patchSettings(state, patch);
    await saveState(state).catch(() => {});
  }
}

async function applyRestoredState(imported, options = {}) {
  clearTimeout(levelTimer);
  genToken += 1;
  const prepared = prepare(imported, new Date());
  state = prepared.state;
  ensureRivalHistory(state, prepared.today);
  ui.pendingImport = null;
  ui.sheet = null;
  ui.draft = null;
  ui.confirm = null;
  ui.levelUp = null;
  ui.editingGemini = false;
  ui.geminiDraft = "";
  ui.geminiError = "";
  ui.revealKey = false;
  ui.lookDate = null;
  ui.selectedDate = null;
  ui.selectedWeekday = null;
  ui.calDate = null;
  ui.calMonth = null;
  ui.exercise = null;
  ui.reordering = false;
  ui.keepScroll = false;
  try {
    await saveState(state);
  } catch (error) {
    toast(error.message || "Couldn't save the restored backup on this phone.");
    paint();
    return;
  }
  paint();
  toast(formatRestoreSummary({ days: imported.days, workouts: state.workouts, xpEvents: state.xpEvents }));
  syncReminderSchedule(state).catch(() => {});
  if (!options.fromDrive) driveScheduler.noteChange();
}

function copyTargetOptions(sheet) {
  if (sheet?.kind === "template") {
    const src = String(sheet.weekday);
    return ["1", "2", "3", "4", "5", "6", "7"].filter((wd) => wd !== src);
  }
  const start = weekStart(dateKey(new Date()));
  return Array.from({ length: 7 }, (_, idx) => addDays(start, idx)).filter((d) => d !== sheet?.date);
}

async function runCopyDay() {
  const sheet = ui.sheet;
  const draft = ui.draft;
  if (!sheet || sheet.type !== "copy-day" || !draft) return;
  const targets = [...new Set((draft.targets || []).map(String))];
  const mode = draft.copyMode === "append" ? "append" : "replace";
  let copied = 0;
  await commitAction((current) => {
    const result = sheet.kind === "template"
      ? copyTemplateWeekday(current, sheet.weekday, targets, mode)
      : copyDayToDates(current, sheet.date, targets, mode, new Date());
    copied = result.copied;
    return result.state;
  }, { close: true, ring: true });
  if (copied > 0) {
    toast(`Copied to ${copied} ${copied === 1 ? "day" : "days"}`);
  }
}

function bindQuestDrag(app) {
  const LONG_PRESS_MS = 360;
  const SCROLL_SLOP_PX = 8;
  let drag = null;
  let pendingHold = null;
  let suppressClickOnRow = null;
  let suppressTimer = 0;

  function armClickSuppression(row) {
    clearTimeout(suppressTimer);
    suppressClickOnRow = row;
    suppressTimer = setTimeout(() => {
      suppressClickOnRow = null;
    }, 120);
  }

  function cancelHold() {
    if (!pendingHold) return;
    clearTimeout(pendingHold.timer);
    pendingHold = null;
  }

  function matchingDropCards() {
    if (!drag) return [];
    return [...app.querySelectorAll("[data-slot-drop]")].filter((card) => (
      drag.isTemplate
        ? card.dataset.template === "true" && card.dataset.weekday === drag.weekday
        : card.dataset.template !== "true" && card.dataset.date === drag.date
    ));
  }

  function pickDrop(clientY) {
    const cards = matchingDropCards();
    if (!cards.length) return null;
    let card = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return clientY >= r.top && clientY <= r.bottom;
    });
    if (!card) {
      let best = Infinity;
      for (const el of cards) {
        const r = el.getBoundingClientRect();
        const d = clientY < r.top ? r.top - clientY : clientY - r.bottom;
        if (d < best) {
          best = d;
          card = el;
        }
      }
    }
    const slot = card.dataset.slotDrop;
    const rows = [...card.querySelectorAll("[data-quest]")].filter((el) => el !== drag.row);
    let index = rows.length;
    let before = null;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        index = i;
        before = rows[i];
        break;
      }
    }
    return { card, slot, index, before, anchor: card.querySelector(".add") };
  }

  function moveGhost(clientY) {
    const y = clientY - drag.offsetY;
    drag.ghost.style.transform = `translate3d(0, ${Math.round(y)}px, 0)`;
    const main = document.getElementById("main");
    if (main) {
      const mr = main.getBoundingClientRect();
      if (clientY < mr.top + 56) main.scrollTop -= 10;
      else if (clientY > mr.bottom - 56) main.scrollTop += 10;
    }
    const drop = pickDrop(clientY);
    if (!drop) return;
    drag.toSlot = drop.slot;
    drag.toIndex = drop.index;
    app.querySelectorAll("[data-slot-drop].drop-over").forEach((el) => el.classList.remove("drop-over"));
    drop.card.classList.add("drop-over");
    const ref = drop.before || drop.anchor || null;
    if (drag.marker.parentElement !== drop.card || drag.marker.nextSibling !== ref) {
      drop.card.insertBefore(drag.marker, ref);
    }
  }

  let ghostRaf = 0;
  let pendingGhostY = null;

  function scheduleGhostMove(clientY) {
    if (!drag) return;
    pendingGhostY = clientY;
    if (ghostRaf) return;
    ghostRaf = requestAnimationFrame(() => {
      ghostRaf = 0;
      if (!drag || pendingGhostY == null) return;
      const y = pendingGhostY;
      pendingGhostY = null;
      moveGhost(y);
    });
  }

  function flushGhostMove() {
    if (ghostRaf) {
      cancelAnimationFrame(ghostRaf);
      ghostRaf = 0;
    }
    if (drag && pendingGhostY != null) {
      const y = pendingGhostY;
      pendingGhostY = null;
      moveGhost(y);
    }
  }

  function onActivePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    event.preventDefault();
    scheduleGhostMove(event.clientY);
  }

  function onActiveTouchMove(event) {
    if (!drag) return;
    event.preventDefault();
    const touch = event.touches?.[0];
    if (touch) {
      if (Math.abs(touch.clientY - drag.startY) > 3) drag.moved = true;
      scheduleGhostMove(touch.clientY);
    }
  }

  function attachActiveDragListeners() {
    window.addEventListener("pointermove", onActivePointerMove, { passive: false });
    window.addEventListener("touchmove", onActiveTouchMove, { passive: false });
  }

  function detachActiveDragListeners() {
    window.removeEventListener("pointermove", onActivePointerMove);
    window.removeEventListener("touchmove", onActiveTouchMove);
  }

  function startDrag({ row, pointerId, clientY, captureEl, fromHold = false }) {
    const rect = row.getBoundingClientRect();
    const parentCard = row.closest("[data-slot-drop]");
    const siblings = parentCard ? [...parentCard.querySelectorAll("[data-quest]")] : [];
    const fromIndex = Math.max(0, siblings.indexOf(row));
    const ghost = row.cloneNode(true);
    ghost.classList.add("quest-drag-ghost");
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.transform = `translate3d(0, ${Math.round(rect.top)}px, 0)`;
    document.getElementById("fx").appendChild(ghost);
    const marker = document.createElement("div");
    marker.className = "quest-drop-line";
    row.classList.add("is-dragging");
    document.body.classList.add("dragging-quest");
    if (captureEl?.setPointerCapture && pointerId != null) {
      try {
        captureEl.setPointerCapture(pointerId);
      } catch {
        /* synthetic or touch-held pointers may not capture */
      }
    }
    haptic("tick");
    const isTemplate = row.dataset.template === "true" || Boolean(row.dataset.weekday);
    drag = {
      pointerId,
      row,
      ghost,
      marker,
      startY: clientY,
      offsetY: Math.min(Math.max(12, clientY - rect.top), Math.max(12, rect.height - 12)),
      moved: false,
      fromHold,
      isTemplate,
      date: row.dataset.date || "",
      weekday: row.dataset.weekday || "",
      fromSlot: row.dataset.slot,
      fromIndex,
      toSlot: row.dataset.slot,
      toIndex: fromIndex,
      id: row.dataset.id,
    };
    attachActiveDragListeners();
    moveGhost(clientY);
  }

  function finish(commitMove) {
    cancelHold();
    if (!drag) return;
    flushGhostMove();
    detachActiveDragListeners();
    const current = drag;
    drag = null;
    current.ghost.remove();
    current.marker.remove();
    current.row.classList.remove("is-dragging");
    app.querySelectorAll("[data-slot-drop].drop-over").forEach((el) => el.classList.remove("drop-over"));
    document.body.classList.remove("dragging-quest");
    if (current.fromHold) armClickSuppression(current.row);
    const sameSpot = current.fromSlot === current.toSlot && current.toIndex === current.fromIndex;
    if (!commitMove || !current.moved || sameSpot) return;
    haptic("tick");
    commitAction(
      (s) => (
        current.isTemplate
          ? moveTemplateTask(s, current.weekday, current.fromSlot, current.id, current.toSlot, current.toIndex)
          : moveTask(s, current.date, current.fromSlot, current.id, current.toSlot, current.toIndex, new Date())
      ),
      { quiet: true },
    );
  }

  app.addEventListener("pointerdown", (event) => {
    if (drag) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const grip = event.target.closest("[data-grip]");
    if (grip) {
      const row = grip.closest("[data-quest]");
      if (!row) return;
      event.preventDefault();
      cancelHold();
      startDrag({
        row,
        pointerId: event.pointerId,
        clientY: event.clientY,
        captureEl: grip,
        fromHold: false,
      });
      return;
    }

    // Touch long-press on a movable quest row (without blocking normal vertical scroll).
    if (event.pointerType !== "touch") return;
    if (event.target.closest(".check, .move-btns")) return;
    const row = event.target.closest("[data-quest]");
    if (!row) return;
    cancelHold();
    const hold = {
      pointerId: event.pointerId,
      row,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      timer: 0,
    };
    hold.timer = setTimeout(() => {
      if (pendingHold !== hold || drag) return;
      pendingHold = null;
      startDrag({
        row: hold.row,
        pointerId: hold.pointerId,
        clientY: hold.lastY,
        captureEl: hold.row,
        fromHold: true,
      });
    }, LONG_PRESS_MS);
    pendingHold = hold;
  });

  app.addEventListener("scroll", () => {
    if (pendingHold && !drag) cancelHold();
  }, true);

  app.addEventListener("contextmenu", (event) => {
    if (drag || pendingHold || event.target.closest("[data-grip]")) {
      event.preventDefault();
    }
  });

  window.addEventListener("pointermove", (event) => {
    if (!pendingHold || event.pointerId !== pendingHold.pointerId) return;
    pendingHold.lastY = event.clientY;
    const dist = Math.hypot(event.clientX - pendingHold.startX, event.clientY - pendingHold.startY);
    if (dist > SCROLL_SLOP_PX) cancelHold();
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (!pendingHold) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    pendingHold.lastY = touch.clientY;
    const dist = Math.hypot(touch.clientX - pendingHold.startX, touch.clientY - pendingHold.startY);
    if (dist > SCROLL_SLOP_PX) cancelHold();
  }, { passive: true });

  window.addEventListener("pointerup", (event) => {
    if (pendingHold && event.pointerId === pendingHold.pointerId) cancelHold();
    if (!drag || event.pointerId !== drag.pointerId) return;
    finish(true);
  }, { passive: true });

  window.addEventListener("pointercancel", (event) => {
    if (pendingHold && event.pointerId === pendingHold.pointerId) cancelHold();
    if (!drag || event.pointerId !== drag.pointerId) return;
    finish(false);
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (pendingHold) cancelHold();
    if (drag) finish(true);
  }, { passive: true });

  window.addEventListener("touchcancel", () => {
    if (pendingHold) cancelHold();
    if (drag) finish(false);
  }, { passive: true });

  return (target) => {
    if (!suppressClickOnRow) return false;
    const hit = target?.closest?.("[data-quest]") === suppressClickOnRow || !suppressClickOnRow.isConnected;
    clearTimeout(suppressTimer);
    suppressClickOnRow = null;
    return hit;
  };
}

function bind() {
  const app = document.getElementById("app");
  ensureBackupInput();
  const shouldSuppressClick = bindQuestDrag(app);
  app.addEventListener("click", (event) => {
    if (shouldSuppressClick(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    scrape();
    const run = actions[el.dataset.action];
    if (run) run(el, event);
  });
  app.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    scrape();
    actions[form.dataset.form]?.();
  });
  app.addEventListener("input", (event) => {
    const el = event.target.closest("#gemini-key, [data-bind]");
    if (!el) return;
    if (el.id === "gemini-key") {
      ui.geminiDraft = el.value;
      ui.geminiError = "";
      document.querySelector(".gemini-card .form-error")?.remove();
      const save = document.querySelector('[data-action="save-gemini"]');
      const current = state.settings.geminiApiKey || "";
      if (save) save.disabled = !el.value.trim() || el.value.trim() === current || ui.geminiBusy;
      return;
    }
    if (el.dataset.commit === "settings") {
      clearTimeout(el._emberTimer);
      const bindName = el.dataset.bind;
      const value = el.value;
      state = patchSettings(state, { [bindName]: value });
      saveState(state).catch(() => {
        toast("Couldn't save on this phone.");
      });
      if (bindName === "workerToken") syncReminderSchedule(state).catch(() => {});
      driveScheduler.noteChange();
      return;
    }
    if (ui.draft) assign(ui.draft, el.dataset.bind, el.type === "checkbox" ? el.checked : el.value);
  });
  app.addEventListener("change", (event) => {
    const copyCheck = event.target.closest("[data-copy-target]");
    if (copyCheck && ui.draft && ui.sheet?.type === "copy-day") {
      const target = copyCheck.dataset.copyTarget;
      const set = new Set((ui.draft.targets || []).map(String));
      if (copyCheck.checked) set.add(target);
      else set.delete(target);
      ui.draft.targets = [...set];
      ui.draft.error = "";
      ui.keepScroll = true;
      paint();
      return;
    }
    const el = event.target.closest("[data-bind]");
    if (!el) return;
    if (el.dataset.commit === "settings") {
      clearTimeout(el._emberTimer);
      const bindName = el.dataset.bind;
      const value = el.value;
      commitAction((current) => patchSettings(current, { [bindName]: value }), { quiet: true });
      return;
    }
    if (!ui.draft) return;
    assign(ui.draft, el.dataset.bind, el.type === "checkbox" ? el.checked : el.value);
    if ("rerenderCheck" in el.dataset) {
      if (el.dataset.bind === "isEvent" && el.checked) ui.draft.saveTemplate = false;
      ui.keepScroll = true;
      paint();
    }
  });
  window.addEventListener("pagehide", () => {
    flushSettingsInputs();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSettingsInputs();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (ui.confirm) actions["confirm-no"]();
    else if (ui.levelUp) actions["dismiss-levelup"]();
    else if (ui.sheet) closeSheet();
  });
  window.addEventListener("popstate", () => {
    if (ui.ignorePop) {
      ui.ignorePop = false;
      return;
    }
    if (ui.sheet) {
      genToken += 1;
      ui.sheet = null;
      ui.draft = null;
      ui.keepScroll = true;
      paint();
    }
  });
  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab === ui.tab) return;
    ui.tab = tab;
    ui.enter = true;
    ui.keepScroll = false;
    paint();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    ui.installEvent = event;
    if (ui.tab === "you" || ui.tab === "settings") paint();
  });
  window.addEventListener("appinstalled", () => {
    ui.installEvent = null;
    if (ui.tab === "you" || ui.tab === "settings") paint();
  });
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type !== "OPEN_TODAY") return;
    ui.lookDate = event.data.date && event.data.date !== dateKey(new Date()) ? event.data.date : null;
    ui.tab = "today";
    setHash("today");
    paint();
  });
}

async function boot() {
  ui.tab = tabFromHash();
  ui.notifyState = globalThis.Notification?.permission || "unsupported";
  let loaded = null;
  try {
    loaded = await loadState();
  } catch {
    loaded = null;
  }
  let initial = createInitialState(new Date());
  if (loaded) {
    try {
      initial = sanitizeImport(loaded);
    } catch {
      initial = createInitialState(new Date());
    }
  }
  const prepared = prepare(initial, new Date());
  state = prepared.state;
  ensureRivalHistory(state, prepared.today);
  try {
    await saveState(state);
  } catch (error) {
    toast(error.message || "Couldn't save on this phone.");
  }
  bind();
  paint();
  if (state.lastPenaltyReport) {
    ui.penaltyWindow = state.lastPenaltyReport;
    sfx("penalty");
    haptic("warn");
    paint();
  }
  await registerServiceWorker();
  watchReminders(() => state);
  syncReminderSchedule(state).catch(() => {});
  refreshNotify().then(() => {
    if (ui.tab === "you") paint();
  });
  driveScheduler.checkOnOpen();
}

const driveScheduler = createAutoBackupController({
  getContext: () => ({ settings: state.settings, clientId: GOOGLE_CLIENT_ID }),
  runBackup: () => backupToDrive({ silent: true }),
});

async function backupToDrive({ silent = false } = {}) {
  if (!GOOGLE_CLIENT_ID) return false;
  if (!silent) await flushSettingsInputs();
  let access;
  try {
    access = await requestDriveToken(
      silent ? "" : (state.settings.driveLinked ? "" : "consent"),
      { silent },
    );
  } catch (error) {
    if (silent) {
      ui.driveStatus = "";
      ui.driveNeedsReconnect = true;
      if (ui.tab === "you") {
        ui.keepScroll = true;
        paint();
      }
      return false;
    }
    throw error;
  }

  const now = new Date();
  try {
    await uploadBackup(access, state, now);
    await pruneBackups(access, 7);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      await clearDriveToken();
      if (silent) {
        ui.driveStatus = "";
        ui.driveNeedsReconnect = true;
        if (ui.tab === "you") {
          ui.keepScroll = true;
          paint();
        }
        return false;
      }
      access = await requestDriveToken("");
      await uploadBackup(access, state, now);
      await pruneBackups(access, 7);
    } else if (silent) {
      ui.driveStatus = "";
      if (ui.tab === "you") {
        ui.keepScroll = true;
        paint();
      }
      return false;
    } else {
      throw error;
    }
  }

  const today = dateKey(now);
  const iso = now.toISOString();
  ui.driveStatus = "";
  ui.driveNeedsReconnect = false;
  driveScheduler.markCompleted(now.getTime());
  await commitAction(
    (current) => patchSettings(current, {
      driveLinked: true,
      driveLastBackupOn: today,
      driveLastBackupAt: iso,
    }),
    { quiet: true, skipDriveSchedule: true },
  );
  return true;
}

boot();
