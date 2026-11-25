import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { sheetHtml, viewSettings } from "../src/ui/screens.js";

test("blocker picker form submits via data-form not click delegate", () => {
  const state = createInitialState(new Date("2026-11-13T12:00:00+01:00"));
  const html = sheetHtml(state, {
    sheet: { type: "blocker-picker" },
    draft: {
      apps: [
        { id: "com.zed", label: "Zed" },
        { id: "com.app", label: "Alpha" },
      ],
      selected: [],
    },
  });
  assert.match(html, /data-form="save-blocked-apps"/);
  assert.match(html, /data-blocked-search[^>]*placeholder="Search apps"/);
  assert.match(html, /class="sheet sheet-blocker"/);
  assert.ok(html.indexOf("Alpha") < html.indexOf("Zed"));
  const picked = sheetHtml(state, {
    sheet: { type: "blocker-picker" },
    draft: {
      apps: [
        { id: "com.app", label: "Alpha" },
        { id: "com.mango", label: "Mango" },
        { id: "com.zed", label: "Zed" },
      ],
      selected: ["com.zed"],
      blockedSearch: "a",
    },
  });
  assert.ok(picked.indexOf("Zed") < picked.indexOf("Alpha"));
  assert.ok(picked.indexOf("Alpha") < picked.indexOf("Mango"));
  const gone = sheetHtml(state, {
    sheet: { type: "blocker-picker" },
    draft: {
      apps: [
        { id: "com.zed", label: "Zed" },
        { id: "com.old.app", label: "Old App", missing: true },
      ],
      selected: ["com.old.app"],
    },
  });
  assert.match(gone, /not in the app list/);
  assert.match(gone, /data-blocked-app="com.old.app"/);
});

test("quiet time inputs use change path not data-action", () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const state = createInitialState(new Date("2026-11-13T12:00:00+01:00"));
  const html = viewSettings(state, { tab: "settings", notifyState: "default", periodic: "unsupported" });
  assert.match(html, /Blocked: YouTube, TikTok \(if installed\)/);
  assert.match(html, /data-quiet-time[^>]*data-parent="quietSchool"/);
  const cleared = viewSettings(
    { ...state, settings: { ...state.settings, blockedPackages: [], blockedPackagesChosen: true } },
    { tab: "settings", notifyState: "default", periodic: "unsupported" },
  );
  assert.match(cleared, /Blocked: None/);
  assert.doesNotMatch(html, /data-action="patch-quiet-time"/);
});