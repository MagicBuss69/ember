import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_GEMINI_FALLBACK_MODEL, CHAT_GEMINI_MODEL } from "../src/constants.js";
import { coachChatTurn, rivalChatTurn } from "../src/gemini.js";

const FAKE = "test-key-do-not-log";

function http(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function okReply(obj) {
  return http(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
}

function errBody(status, message, apiStatus = "") {
  return http(status, { error: { code: status, message, status: apiStatus } });
}

async function withFetch(handler, run) {
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    return handler(href, calls);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = prev;
  }
}

function isPrimary(url) {
  return url.includes(CHAT_GEMINI_MODEL) && !url.includes(CHAT_GEMINI_FALLBACK_MODEL);
}

test("503 on the primary model returns the fallback reply", async () => {
  await withFetch((url) => (
    isPrimary(url) ? errBody(503, "high demand", "UNAVAILABLE") : okReply({ reply: "fallback reply", actions: [] })
  ), async (calls) => {
    const coach = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(coach.reply, "fallback reply");
    const rival = await rivalChatTurn(FAKE, { name: "Leo" }, [], "hey");
    assert.equal(rival.reply, "fallback reply");
    assert.equal(calls.length, 4);
    assert.ok(calls.filter(isPrimary).length === 2);
    assert.ok(calls.filter((url) => url.includes(CHAT_GEMINI_FALLBACK_MODEL)).length === 2);
    assert.equal(calls.some((url) => url.includes(FAKE)), false);
  });
});

test("a network error on the primary model falls back", async () => {
  await withFetch((url) => {
    if (isPrimary(url)) throw new TypeError("Failed to fetch");
    return okReply({ reply: "after network", actions: [] });
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "after network");
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes(CHAT_GEMINI_FALLBACK_MODEL));
  });
});

test("both models failing surfaces an error without the key", async () => {
  await withFetch(() => errBody(503, `overloaded ${FAKE}`, "UNAVAILABLE"), async (calls) => {
    await assert.rejects(
      () => coachChatTurn(FAKE, {}, [], "hello"),
      (error) => {
        assert.equal(error.message.includes(FAKE), false);
        assert.match(error.message, /overloaded|UNAVAILABLE|Gemini/i);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });
});

test("a bad key does not fall back", async () => {
  await withFetch(() => errBody(400, `API key ${FAKE} not valid`, "INVALID_ARGUMENT"), async (calls) => {
    await assert.rejects(
      () => coachChatTurn(FAKE, {}, [], "hello"),
      (error) => {
        assert.equal(error.message.includes(FAKE), false);
        assert.match(error.message, /refused|key/i);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls.some((url) => url.includes(CHAT_GEMINI_FALLBACK_MODEL)), false);
  });
});
