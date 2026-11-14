import { kvGet, kvSet } from "./idb.js";

const COACH_KEY = "coach-chat";
const RIVAL_PREFIX = "rival-chat-";
const COACH_CAP = 40;
const RIVAL_CAP = 30;

const KEY_LIKE = /AIza[A-Za-z0-9_-]{20,}/g;

export function redactChatText(text) {
  return String(text || "").replace(KEY_LIKE, "[redacted]");
}

function capMessages(list, limit) {
  const clean = (list || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m) => ({
      role: m.role,
      text: redactChatText(m.text).slice(0, 4000),
      at: typeof m.at === "string" ? m.at.slice(0, 40) : new Date().toISOString(),
    }));
  return clean.slice(-limit);
}

export async function loadCoachChat() {
  try {
    const stored = await kvGet(COACH_KEY);
    if (Array.isArray(stored)) return capMessages(stored, COACH_CAP);
  } catch {
    /* ignore */
  }
  return [];
}

export async function saveCoachChat(messages) {
  await kvSet(COACH_KEY, capMessages(messages, COACH_CAP));
}

export async function loadRivalChat(rivalId) {
  const id = String(rivalId || "").slice(0, 24);
  if (!id) return [];
  try {
    const stored = await kvGet(`${RIVAL_PREFIX}${id}`);
    if (Array.isArray(stored)) return capMessages(stored, RIVAL_CAP);
  } catch {
    /* ignore */
  }
  return [];
}

export async function saveRivalChat(rivalId, messages) {
  const id = String(rivalId || "").slice(0, 24);
  if (!id) return;
  await kvSet(`${RIVAL_PREFIX}${id}`, capMessages(messages, RIVAL_CAP));
}