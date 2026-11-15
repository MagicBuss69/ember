import { esc } from "../format.js";
import { coachStreamDisplayText } from "../gemini.js";
import { icon } from "../icons.js";
import { RIVALS } from "../rivals.js";

export const CHAT_LOG_SELECTOR = ".chat-sheet .chat-log";

export function applyChatLogScrollEnd(el) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

export function scrollChatLogToBottom(root, selector = CHAT_LOG_SELECTOR) {
  const el = root?.querySelector?.(selector);
  if (!el) return;
  requestAnimationFrame(() => applyChatLogScrollEnd(el));
}

function bubbleText(msg) {
  if (msg.streaming) return esc(coachStreamDisplayText(msg.text) || "…");
  return esc(msg.text);
}

function messageRows(messages) {
  return (messages || [])
    .map(
      (msg) => `<div class="chat-bubble ${msg.role === "user" ? "is-user" : "is-coach"}${msg.streaming ? " is-streaming" : ""}">
        <p>${bubbleText(msg)}</p>
      </div>`,
    )
    .join("");
}

export function coachSheetHtml(draft) {
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";
  const busy = draft.loading;
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet chat-sheet" data-form="send-coach">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>Coach</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">Ask to add quests, tweak the week, or adjust settings. Destructive steps ask you to confirm first.</p>
      ${error}
      <div class="chat-log" role="log" aria-live="polite">${messageRows(draft.messages)}</div>
      <label class="field">
        <span>Message</span>
        <textarea data-bind="draft" rows="3" maxlength="2000" placeholder="Add a morning quest tomorrow…" ${busy ? "disabled" : ""}>${esc(draft.draft || "")}</textarea>
      </label>
      <button type="submit" class="primary" ${busy || !(draft.draft || "").trim() ? "disabled" : ""}>${busy ? "Thinking…" : "Send"}</button>
    </form>`;
}

export function rivalChatSheetHtml(draft) {
  const rival = RIVALS.find((row) => row.id === draft.rivalId);
  const title = rival ? rival.name.split(" ")[0] : "Rival";
  const error = draft.error ? `<p class="form-error">${esc(draft.error)}</p>` : "";
  const busy = draft.loading;
  return `
    <div class="scrim" data-action="close-sheet"></div>
    <form class="sheet chat-sheet" data-form="send-rival">
      <div class="handle"></div>
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
      </div>
      <p class="lede">Simulated on this phone. Progress matches the Rivals board.</p>
      ${error}
      <div class="chat-log" role="log" aria-live="polite">${messageRows(draft.messages)}</div>
      <label class="field">
        <span>Message</span>
        <textarea data-bind="draft" rows="3" maxlength="2000" placeholder="Say something…" ${busy ? "disabled" : ""}>${esc(draft.draft || "")}</textarea>
      </label>
      <button type="submit" class="primary" ${busy || !(draft.draft || "").trim() ? "disabled" : ""}>${busy ? "Thinking…" : "Send"}</button>
    </form>`;
}

/** Update only the in-progress assistant bubble while streaming (no full paint). */
export function updateStreamingChatBubble(displayText, root = document) {
  const log = root.querySelector(CHAT_LOG_SELECTOR);
  const bubble = log?.querySelector(".chat-bubble.is-streaming p");
  if (bubble) bubble.textContent = displayText || "…";
  applyChatLogScrollEnd(log);
}