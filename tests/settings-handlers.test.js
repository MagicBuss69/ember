import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { sheetHtml, viewSettings } from "../src/ui/screens.js";

test("blocker picker form submits via data-form not click delegate", () => {
  const state = createInitialState(new Date("2026-11-13T12:00:00+01:00"));
  const html = sheetHtml(state, {
    sheet: { type: "blocker-picker" },
    draft: { apps: [{ id: "com.app", label: "App" }], selected: [] },
  });
  assert.match(html, /data-form="save-blocked-apps"/);
  assert.doesNotMatch(html, /<form[^>]*data-action="save-blocked-apps"/);
  assert.match(html, /data-blocked-app=/);
});

test("quiet time inputs use change path not data-action", () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const state = createInitialState(new Date("2026-11-13T12:00:00+01:00"));
  const html = viewSettings(state, { tab: "settings", notifyState: "default", periodic: "unsupported" });
  assert.match(html, /data-quiet-time[^>]*data-parent="quietSchool"/);
  assert.doesNotMatch(html, /data-action="patch-quiet-time"/);
});