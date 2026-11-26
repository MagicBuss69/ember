import assert from "node:assert/strict";
import test from "node:test";
import { openChallenge } from "../src/challenges.js";
import { createInitialState } from "../src/domain.js";
import { render } from "../src/ui/render.js";
import {
  challengeChromeState,
  challengeLiveHtml,
  challengePinHtml,
  challengePopupAllowsAction,
} from "../src/ui/screens.js";

const NOW = new Date("2026-11-13T20:00:00+01:00");

function withChallenge() {
  const state = createInitialState(NOW);
  openChallenge(state, NOW, "pin-test");
  state.challenges.current.label = "Squats";
  state.challenges.current.reps = 15;
  state.challenges.current.isSeconds = false;
  return state;
}

test("a new hourly challenge opens the popup and keeps the top bar", () => {
  const state = withChallenge();
  const fresh = challengeChromeState(state, {});
  assert.equal(fresh.popup, true);
  assert.equal(fresh.pin, true);
  assert.equal(fresh.hidden, false);

  const hidden = challengeChromeState(state, {
    challengeSeenId: state.challenges.current.id,
    challengeHidden: true,
  });
  assert.equal(hidden.popup, false);
  assert.equal(hidden.pin, true);
  assert.equal(hidden.hidden, true);

  const next = withChallenge();
  next.challenges.current.id = "other-challenge";
  const reopened = challengeChromeState(next, {
    challengeSeenId: state.challenges.current.id,
    challengeHidden: true,
  });
  assert.equal(reopened.popup, true);
  assert.equal(reopened.pin, true);
  assert.equal(reopened.seenId, "other-challenge");
});

test("the live popup stays up until Done, Skip, or Hide", () => {
  const state = withChallenge();
  const html = challengeLiveHtml(state, NOW);
  assert.match(html, /data-challenge-live/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Squats/);
  assert.match(html, /data-action="confirm-challenge"/);
  assert.match(html, /data-action="skip-challenge"/);
  assert.match(html, /data-action="hide-challenge"/);
  assert.match(html, />Hide</);
  assert.doesNotMatch(html, /<aside[^>]*data-action/);
  assert.doesNotMatch(html, /data-action="close-sheet"/);
  assert.equal(challengeLiveHtml(state, NOW, { hidden: true }), "");
  assert.equal(challengeLiveHtml(createInitialState(NOW), NOW), "");

  for (const action of ["confirm-challenge", "skip-challenge", "hide-challenge", "show-challenge"]) {
    assert.equal(challengePopupAllowsAction(action), true);
  }
  for (const action of ["close-sheet", "tab", "confirm-no", "dismiss-levelup", ""]) {
    assert.equal(challengePopupAllowsAction(action), false);
  }
});

test("the top bar shows the active challenge on every screen", () => {
  const state = withChallenge();
  const pin = challengePinHtml(state, NOW, { open: true });
  assert.match(pin, /data-challenge-pin/);
  assert.match(pin, /data-action="show-challenge"/);
  assert.match(pin, /aria-expanded="true"/);
  assert.match(pin, /Squats/);
  assert.match(pin, />15</);
  assert.match(pin, /data-challenge-countdown/);
  assert.match(pin, /reps/);
  assert.equal(challengePinHtml(createInitialState(NOW), NOW), "");

  const hiddenUi = { tab: "week", weekMode: "week", challengeHidden: true, enter: false };
  const week = render(state, hiddenUi, NOW);
  assert.match(week, /data-challenge-pin/);
  assert.match(week, /Squats/);
  assert.doesNotMatch(week, /data-challenge-live/);
  assert.match(week, /This week/);

  const openUi = { tab: "today", challengeHidden: false, enter: false };
  const today = render(state, openUi, NOW);
  assert.match(today, /data-challenge-pin/);
  assert.match(today, /data-challenge-live/);
  assert.match(today, /data-action="hide-challenge"/);
  assert.match(today, /class="challenge-pin is-open"/);
});
