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

const thinkingConfigRejected = new Set();

export function resetThinkingConfigRejections() {
  thinkingConfigRejected.clear();
}

function isGemini3Model(model) {
  return /gemini-3/i.test(String(model || ""));
}

function attachThinkingConfig(generationConfig, model) {
  if (isGemini3Model(model)) {
    const level = /gemini-3\.8-flash/i.test(model) ? "low" : "minimal";
    generationConfig.thinkingConfig = { thinkingLevel: level };
  } else {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
}

function shouldAttachThinking(model, skipThinking) {
  return !skipThinking && !thinkingConfigRejected.has(model);
}

async function callModel(model, apiKey, goals, signal, skipThinking) {
  const body = {
    contents: [{ role: "user", parts: [{ text: `${PROMPT_HEAD}${goals.trim() || "General health, coding, and confidence for a teenager in school."}` }] }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  };
  if (shouldAttachThinking(model, skipThinking)) attachThinkingConfig(body.generationConfig, model);
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

function geminiAuthRefusal(error) {
  const status = error?.status;
  if (status === 401 || status === 403) return true;
  const text = `${error?.detail || ""} ${error?.message || ""}`;
  return status === 400 && /api key/i.test(text);
}

function invalidArgument400(error) {
  return error?.status === 400 && !geminiAuthRefusal(error);
}

function buildChatBody(model, prompt, skipThinking) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
    },
  };
  if (shouldAttachThinking(model, skipThinking)) attachThinkingConfig(body.generationConfig, model);
  return body;
}

function chatHttpError(response, payload, apiKey) {
  const msg = payload?.error?.message || "";
  const error = new Error(chatFriendly(response.status, msg, apiKey));
  error.status = response.status;
  error.apiStatus = payload?.error?.status || "";
  error.detail = redactSensitive(msg, apiKey);
  return error;
}

export function textDeltaFromSseData(data) {
  const raw = String(data || "").trim();
  if (!raw || raw === "[DONE]") return "";
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return "";
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || "Gemini stream error.");
    error.status = payload.error.code || 502;
    error.apiStatus = payload.error.status || "";
    error.detail = redactSensitive(payload.error.message || "", "");
    throw error;
  }
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("");
}

/** Accumulates SSE chunks; exported for tests. */
export function createSseDeltaParser() {
  let lineBuffer = "";
  let eventData = [];
  const flushEvent = (emit) => {
    if (!eventData.length) return;
    const joined = eventData.join("\n");
    eventData = [];
    const delta = textDeltaFromSseData(joined);
    if (delta) emit(delta);
  };
  return {
    feed(chunk, emit) {
      lineBuffer += String(chunk ?? "");
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) >= 0) {
        let line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          flushEvent(emit);
          continue;
        }
        if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
      }
    },
    finish(emit) {
      const trailing = lineBuffer.trim();
      if (trailing.startsWith("data:")) eventData.push(trailing.slice(5).trimStart());
      lineBuffer = "";
      flushEvent(emit);
    },
  };
}

function isStreamBodyReadError(error) {
  if (error instanceof TypeError) return true;
  const name = String(error?.name || "");
  return name === "AbortError" || name === "TimeoutError" || name === "NetworkError";
}

export async function readStreamText(response, onChunk) {
  const body = response?.body;
  if (!body?.getReader) {
    const error = new Error("Couldn't reach Gemini.");
    error.network = true;
    throw error;
  }
  const parser = createSseDeltaParser();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let textSoFar = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        parser.feed(decoder.decode(value, { stream: true }), (delta) => {
          textSoFar += delta;
          onChunk?.({ textSoFar, delta });
        });
      }
      if (done) {
        const tail = decoder.decode();
        if (tail) {
          parser.feed(tail, (delta) => {
            textSoFar += delta;
            onChunk?.({ textSoFar, delta });
          });
        }
        break;
      }
    }
    parser.finish((delta) => {
      textSoFar += delta;
      onChunk?.({ textSoFar, delta });
    });
  } catch (error) {
    if (textSoFar) {
      error.partialText = textSoFar;
    } else if (isStreamBodyReadError(error)) {
      error.network = true;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!textSoFar.trim()) {
    const error = new Error("Gemini returned an empty reply.");
    error.status = 502;
    throw error;
  }
  return textSoFar;
}

async function postChatStream(model, apiKey, prompt, signal, skipThinking, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(buildChatBody(model, prompt, skipThinking)),
      signal,
    });
  } catch {
    const error = new Error("Couldn't reach Gemini.");
    error.network = true;
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw chatHttpError(response, payload, apiKey);
  }
  const text = await readStreamText(response, onChunk);
  return extractJson(text);
}

async function chatStreamWithModel(model, apiKey, prompt, signal, onChunk) {
  const hadThinking = shouldAttachThinking(model, false);
  try {
    return await postChatStream(model, apiKey, prompt, signal, false, onChunk);
  } catch (error) {
    if (invalidArgument400(error) && hadThinking) {
      thinkingConfigRejected.add(model);
      return postChatStream(model, apiKey, prompt, signal, true, onChunk);
    }
    throw error;
  }
}

function chatShouldFallback(error) {
  if (geminiAuthRefusal(error)) return false;
  const status = error?.status;
  if (status === 400) return true;
  if (error?.network || status === 404 || status === 429 || status === 500 || status === 503) return true;
  const text = `${error?.apiStatus || ""} ${error?.detail || ""} ${error?.message || ""}`;
  return /unavailable|overloaded|high demand|resource_exhausted/i.test(text);
}

function isTimeoutAbort(signal) {
  return signal?.reason?.name === "TimeoutError";
}

async function chatWithFallbackStream(apiKey, prompt, signal, onChunk) {
  let gotChunk = false;
  let partialText = "";
  const trackChunk = (info) => {
    gotChunk = true;
    partialText = info.textSoFar;
    onChunk?.(info);
  };
  try {
    return await chatStreamWithModel(CHAT_GEMINI_MODEL, apiKey, prompt, signal, trackChunk);
  } catch (error) {
    if (signal?.aborted && !isTimeoutAbort(signal)) throw error;
    if (gotChunk) {
      error.partialText = partialText;
      throw error;
    }
    if (!chatShouldFallback(error)) throw error;
    return chatStreamWithModel(CHAT_GEMINI_FALLBACK_MODEL, apiKey, prompt, AbortSignal.timeout(30000), onChunk);
  }
}

function trimIncompleteJsonEscape(piece) {
  return String(piece || "").replace(/\\(?:u[0-9a-fA-F]{0,3})?$/i, "");
}

export function decodePartialJsonStringContent(piece) {
  const trimmed = trimIncompleteJsonEscape(piece);
  try {
    return JSON.parse(`"${trimmed}"`);
  } catch {
    let out = "";
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const next = trimmed[i + 1];
      if (next === undefined) break;
      if (next === "n") {
        out += "\n";
        i += 1;
        continue;
      }
      if (next === "r") {
        out += "\r";
        i += 1;
        continue;
      }
      if (next === "t") {
        out += "\t";
        i += 1;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 1;
        continue;
      }
      if (next === "\\") {
        out += "\\";
        i += 1;
        continue;
      }
      if (next === "u") {
        const hex = trimmed.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCodePoint(parseInt(hex, 16));
          i += 5;
          continue;
        }
      }
      out += next;
      i += 1;
    }
    return out;
  }
}

export function coachStreamDisplayText(buffer) {
  const raw = String(buffer || "");
  const matches = [...raw.matchAll(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/g)];
  if (!matches.length) return "";
  const piece =
    raw.includes('"actions"') && matches.length > 1
      ? matches[matches.length - 1][1]
      : matches[0][1];
  return decodePartialJsonStringContent(piece);
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

const RIVAL_INSTRUCTIONS = `You are one of Ember's simulated rivals chatting in-app. Stay in character. Use the facts JSON only; do not invent different XP, streak, or task counts. todayTasksDone, todayTasksPlanned, and recentActivity are what you actually did.
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

export async function coachChatTurn(apiKey, context, history, message, signal, onChunk) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini key in Setup first.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You're offline. Connect once to chat.");
  }
  const prompt = `${COACH_INSTRUCTIONS}\n\nContext:\n${JSON.stringify(context)}\n\nRecent chat:\n${JSON.stringify((history || []).slice(-10))}\n\nUser message:\n${String(message || "").slice(0, 2000)}`;
  const payload = await chatWithFallbackStream(key, prompt, signal, onChunk);
  return parseCoachPayload(payload);
}

export async function rivalChatTurn(apiKey, facts, history, message, signal, onChunk) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini key in Setup first.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You're offline. Connect once to chat.");
  }
  const prompt = `${RIVAL_INSTRUCTIONS}\n\nCharacter facts:\n${JSON.stringify(facts)}\n\nRecent chat:\n${JSON.stringify((history || []).slice(-10))}\n\nUser message:\n${String(message || "").slice(0, 2000)}`;
  const payload = await chatWithFallbackStream(key, prompt, signal, onChunk);
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
      const hadThinking = shouldAttachThinking(model, false);
      try {
        return await callModel(model, key, goals, signal, false);
      } catch (error) {
        if (invalidArgument400(error) && hadThinking) {
          thinkingConfigRejected.add(model);
          return await callModel(model, key, goals, signal, true);
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
