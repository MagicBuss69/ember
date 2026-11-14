import { CHAT_GEMINI_FALLBACK_MODEL, CHAT_GEMINI_MODEL, GEMINI_MODELS, SLOTS } from "./constants.js";
import { validTime } from "./domain.js";

const PROMPT_HEAD = `You plan one week of self-improvement quests for a teenager in Sweden who is in school.
Return ONLY JSON with this shape:
{"days":[{"weekday":1,"morning":[{"title":"","why":"","time":"07:30"}],"afternoon":[],"evening":[]}]}
weekday 1 is Monday through 7 Sunday.
2 to 4 quests per day total, spread across morning, afternoon, and evening.
Titles under 48 characters. why under 90 characters, a concrete reason. time is 24-hour HH:MM.
School days: morning before 08:00, afternoon after 15:30, evening before 21:30. Weekends may start later.
Quests are concrete actions. No medical claims, no extreme diets, no supplements, no dangerous stunts, no vague lines like "be confident".
Goals:
`;

export function geminiKeyEnding(key) {
  const trimmed = String(key || "").trim();
  if (trimmed.length < 4) return "";
  return trimmed.slice(-4);
}

export function decideGeminiSave({ online, status }) {
  if (!online) return { action: "save", status: "offline" };
  if (status === 200 || status === 429) return { action: "save", status: "ok" };
  if (status === 400 || status === 401 || status === 403) {
    return {
      action: "reject",
      message: "That key was refused. Check it in Google AI Studio. Nothing was saved.",
    };
  }
  if (status == null) {
    return { action: "reject", message: "Couldn't reach Gemini. Nothing was saved." };
  }
  return { action: "reject", message: "Gemini didn't accept that check. Nothing was saved." };
}

/** Cheap models-list check. The key is never written to a log or an error string. */
export async function checkGeminiKey(key) {
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  if (!online) return decideGeminiSave({ online: false });
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      method: "GET",
      headers: { "x-goog-api-key": key },
    });
    return decideGeminiSave({ online: true, status: response.status });
  } catch {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return decideGeminiSave({ online: false });
    }
    return decideGeminiSave({ online: true, status: null });
  }
}

export function extractJson(text) {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini didn't return a plan.");
  return JSON.parse(raw.slice(start, end + 1));
}

export function normalizePlan(value) {
  if (!value || !Array.isArray(value.days)) throw new Error("Gemini didn't return a week.");
  const days = [];
  for (const day of value.days) {
    const weekday = Number(day.weekday);
    if (weekday < 1 || weekday > 7) continue;
    const next = { weekday };
    let count = 0;
    for (const slot of SLOTS) {
      next[slot] = [];
      const items = Array.isArray(day[slot]) ? day[slot] : [];
      for (const item of items) {
        if (count >= 5) break;
        const title = String(item?.title || "").trim().slice(0, 80);
        if (!title) continue;
        next[slot].push({
          title,
          why: String(item?.why || "").trim().slice(0, 160),
          time: validTime(item?.time),
        });
        count += 1;
      }
    }
    days.push(next);
  }
  if (!days.length) throw new Error("Gemini returned an empty week.");
  return { days };
}

function readText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) {
    const message = payload?.error?.message || "Gemini returned an empty reply.";
    const error = new Error(message);
    error.status = payload?.error?.code || 502;
    throw error;
  }
  return text;
}

async function callModel(model, apiKey, goals, signal, withThinking) {
  const body = {
    contents: [{ role: "user", parts: [{ text: `${PROMPT_HEAD}${goals.trim() || "General health, coding, and confidence for a teenager in school."}` }] }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  };
  if (withThinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(friendly(response.status, payload?.error?.message));
    error.status = response.status;
    error.detail = payload?.error?.message || "";
    throw error;
  }
  return normalizePlan(extractJson(readText(payload)));
}

function friendly(status, message) {
  if (status === 400 && /api key/i.test(message || "")) return "That key was refused. Check it in Google AI Studio.";
  if (status === 401 || status === 403) return "That key was refused. Check it in Google AI Studio.";
  if (status === 429) return "Gemini's free tier is rate-limiting right now. Try again in a minute. Your week is unchanged.";
  if (status === 404) return "That Gemini model isn't available on the free tier right now.";
  return message || `Gemini returned ${status}. Your week is unchanged.`;
}

const KEY_LIKE = /AIza[A-Za-z0-9_-]{20,}/gi;

export function redactSensitive(text, apiKey = "") {
  let out = String(text || "");
  const key = String(apiKey || "").trim();
  if (key.length >= 8) {
    out = out.split(key).join("[redacted]");
  }
  return out.replace(KEY_LIKE, "[redacted]");
}

function chatFriendly(status, message, apiKey) {
  const detail = redactSensitive(message, apiKey);
  if (status === 400 && /api key/i.test(detail)) return "That key was refused. Check it in Google AI Studio.";
  if (status === 401 || status === 403) return "That key was refused. Check it in Google AI Studio.";
  if (status === 429) return "Gemini's free tier is rate-limiting right now. Try again in a minute.";
  if (status === 404) return "That Gemini model isn't available on the free tier right now.";
  return detail || "Gemini didn't answer.";
}

async function postChatJson(model, apiKey, prompt, signal, withThinking) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
    },
  };
  if (withThinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  } catch {
    const error = new Error("Couldn't reach Gemini.");
    error.network = true;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.error?.message || "";
    const error = new Error(chatFriendly(response.status, msg, apiKey));
    error.status = response.status;
    error.apiStatus = payload?.error?.status || "";
    error.detail = redactSensitive(msg, apiKey);
    throw error;
  }
  return extractJson(readText(payload));
}

async function chatWithModel(model, apiKey, prompt, signal) {
  try {
    return await postChatJson(model, apiKey, prompt, signal, true);
  } catch (error) {
    if (error.status === 400 && /thinking/i.test(error.detail || "")) {
      return postChatJson(model, apiKey, prompt, signal, false);
    }
    throw error;
  }
}

function chatShouldFallback(error) {
  const status = error?.status;
  if (error?.network || status === 404 || status === 429 || status === 500 || status === 503) return true;
  const text = `${error?.apiStatus || ""} ${error?.detail || ""} ${error?.message || ""}`;
  return /unavailable|overloaded|high demand|resource_exhausted/i.test(text);
}

async function chatWithFallback(apiKey, prompt, signal) {
  try {
    return await chatWithModel(CHAT_GEMINI_MODEL, apiKey, prompt, signal);
  } catch (error) {
    if (!chatShouldFallback(error)) throw error;
    return chatWithModel(CHAT_GEMINI_FALLBACK_MODEL, apiKey, prompt, signal);
  }
}

const COACH_INSTRUCTIONS = `You are Ember's in-app coach for a private self-improvement PWA (quests, templates, calendar events, settings).
Use the JSON context you receive. Reply in plain, short English (teen-friendly, not preachy).
Return ONLY JSON: {"reply":"your message to the user","actions":[]}
actions is optional. Each action is {"name":"...", ...fields}. Never return code, scripts, or unknown action names.
Allowed action names only: addQuest, addEvent, addTemplateQuest, setQuestDone, updateQuest, updateEvent, updateTemplateQuest, deleteQuest, deleteEvent, deleteTemplateQuest, moveQuest, copyDay, copyTemplate, fillOpenDays, saveDayToTemplate, useTemplateOnDay, applyWeekPlan, setGoals, patchSettings.
Quest fields: date YYYY-MM-DD, slot morning|afternoon|evening, title, why, time HH:MM, taskId when editing.
Template weekday is 1=Monday … 7=Sunday. copyDay/copyTemplate use mode append or replace, sourceDate/sourceWeekday, targetDates/targetWeekdays arrays.
patchSettings may only change sound, haptics, soundVolume, theme, crystalSkin, equippedTitle, checkFx, soundPack (owned items only).
Never touch API keys, Drive, worker tokens, purchases, workouts, or reset. Max 6 actions per reply.`;

const RIVAL_INSTRUCTIONS = `You are one of Ember's simulated rivals chatting in-app. Stay in character. Use the facts JSON only; do not invent different XP or streak numbers.
Return ONLY JSON: {"reply":"…"} with no actions field. If asked to change quests, tell them to ask the Coach instead.`;

export function parseCoachPayload(value) {
  const reply = redactSensitive(String(value?.reply || "").trim()).slice(0, 4000);
  const actions = Array.isArray(value?.actions) ? value.actions : [];
  if (!reply && !actions.length) throw new Error("Gemini sent an empty reply.");
  return { reply: reply || "Done.", actions };
}

export function parseRivalPayload(value) {
  const reply = redactSensitive(String(value?.reply || "").trim()).slice(0, 4000);
  if (!reply) throw new Error("Gemini sent an empty reply.");
  return { reply };
}

export async function coachChatTurn(apiKey, context, history, message, signal) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini key in Setup first.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You're offline. Connect once to chat.");
  }
  const prompt = `${COACH_INSTRUCTIONS}\n\nContext:\n${JSON.stringify(context)}\n\nRecent chat:\n${JSON.stringify((history || []).slice(-10))}\n\nUser message:\n${String(message || "").slice(0, 2000)}`;
  const payload = await chatWithFallback(key, prompt, signal);
  return parseCoachPayload(payload);
}

export async function rivalChatTurn(apiKey, facts, history, message, signal) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini key in Setup first.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You're offline. Connect once to chat.");
  }
  const prompt = `${RIVAL_INSTRUCTIONS}\n\nCharacter facts:\n${JSON.stringify(facts)}\n\nRecent chat:\n${JSON.stringify((history || []).slice(-10))}\n\nUser message:\n${String(message || "").slice(0, 2000)}`;
  const payload = await chatWithFallback(key, prompt, signal);
  return parseRivalPayload(payload);
}

export async function generateWeek(apiKey, goals, signal) {
  const key = String(apiKey || "").trim();
  if (!key) {
    const error = new Error("Add a free Gemini key first. The rest of Ember works without one.");
    error.status = 0;
    throw error;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You're offline. Connect once to ask Gemini, or build the week yourself.");
  }
  let last = null;
  for (const model of GEMINI_MODELS) {
    try {
      try {
        return await callModel(model, key, goals, signal, true);
      } catch (error) {
        if (error.status === 400 && /thinking/i.test(error.detail || "")) {
          return await callModel(model, key, goals, signal, false);
        }
        throw error;
      }
    } catch (error) {
      last = error;
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw last || new Error("Gemini didn't answer.");
}
