import { GEMINI_MODELS, SLOTS } from "./constants.js";
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
