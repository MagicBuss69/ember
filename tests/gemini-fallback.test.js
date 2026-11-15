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
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push(href);
    return handler(href, calls, init);
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

function bodyHasThinking(init) {
  const body = JSON.parse(String(init?.body || "{}"));
  return Boolean(body.generationConfig?.thinkingConfig);
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

test("primary timeout then fallback succeeds with a fresh abort signal", async () => {
  const primaryTimeout = AbortSignal.timeout(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(primaryTimeout.aborted, true);
  assert.equal(primaryTimeout.reason?.name, "TimeoutError");
  let fallbackSignal;
  await withFetch((url, _calls, init) => {
    if (isPrimary(url)) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    fallbackSignal = init?.signal;
    return okReply({ reply: "after timeout fallback", actions: [] });
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello", primaryTimeout);
    assert.equal(result.reply, "after timeout fallback");
    assert.equal(calls.length, 2);
    assert.equal(fallbackSignal?.aborted, false);
  });
});

test("the fallback request uses a signal that is not already aborted", async () => {
  let fallbackSignal;
  await withFetch((url, _calls, init) => (
    isPrimary(url)
      ? errBody(503, "high demand", "UNAVAILABLE")
      : (fallbackSignal = init?.signal, okReply({ reply: "ok", actions: [] }))
  ), async (calls) => {
    await coachChatTurn(FAKE, {}, [], "hello", AbortSignal.timeout(45000));
    assert.equal(calls.length, 2);
    assert.equal(fallbackSignal?.aborted, false);
  });
});

test("a deliberate user abort does not call the fallback model", async () => {
  const user = new AbortController();
  user.abort(new DOMException("cancelled", "AbortError"));
  await withFetch((url) => {
    if (isPrimary(url)) throw new DOMException("cancelled", "AbortError");
    return okReply({ reply: "should not run", actions: [] });
  }, async (calls) => {
    await assert.rejects(() => coachChatTurn(FAKE, {}, [], "hello", user.signal));
    assert.equal(calls.length, 1);
    assert.ok(isPrimary(calls[0]));
  });
});

test("400 INVALID_ARGUMENT retries once without thinkingConfig", async () => {
  let primaryAttempts = 0;
  await withFetch((url, _calls, init) => {
    if (!isPrimary(url)) return okReply({ reply: "skip", actions: [] });
    primaryAttempts += 1;
    if (primaryAttempts === 1) {
      assert.equal(bodyHasThinking(init), true);
      return errBody(400, "Request contains an invalid argument", "INVALID_ARGUMENT");
    }
    assert.equal(bodyHasThinking(init), false);
    return okReply({ reply: "after thinking retry", actions: [] });
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "after thinking retry");
    assert.equal(calls.filter(isPrimary).length, 2);
  });
});

test("two 400s on the primary model fall back to flash-lite", async () => {
  await withFetch((url) => (
    isPrimary(url)
      ? errBody(400, "Request contains an invalid argument", "INVALID_ARGUMENT")
      : okReply({ reply: "lite reply", actions: [] })
  ), async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "lite reply");
    assert.equal(calls.filter(isPrimary).length, 2);
    assert.equal(calls.filter((url) => url.includes(CHAT_GEMINI_FALLBACK_MODEL)).length, 1);
  });
});

test("403 on the primary model does not fall back", async () => {
  await withFetch(() => errBody(403, "API key not valid", "PERMISSION_DENIED"), async (calls) => {
    await assert.rejects(
      () => coachChatTurn(FAKE, {}, [], "hello"),
      (error) => {
        assert.match(error.message, /refused|key/i);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls.some((url) => url.includes(CHAT_GEMINI_FALLBACK_MODEL)), false);
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
