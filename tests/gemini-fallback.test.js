import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_GEMINI_FALLBACK_MODEL, CHAT_GEMINI_MODEL } from "../src/constants.js";
import { coachChatTurn, resetThinkingConfigRejections, rivalChatTurn } from "../src/gemini.js";

const FAKE = "test-key-do-not-log";

function sseLine(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function streamOkReply(obj) {
  const text = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseLine({ candidates: [{ content: { parts: [{ text }] } }] })));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream };
}

function errBody(status, message, apiStatus = "") {
  return { ok: false, status, json: async () => ({ error: { code: status, message, status: apiStatus } }) };
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

function parseBody(init) {
  return JSON.parse(String(init?.body || "{}"));
}

function bodyHasThinking(init) {
  return Boolean(parseBody(init).generationConfig?.thinkingConfig);
}

function bodyThinkingBudget(init) {
  return parseBody(init).generationConfig?.thinkingConfig?.thinkingBudget;
}

test.beforeEach(() => {
  resetThinkingConfigRejections();
});

test("503 on the primary model returns the fallback reply", async () => {
  await withFetch((url) => (
    isPrimary(url) ? errBody(503, "high demand", "UNAVAILABLE") : streamOkReply({ reply: "fallback reply", actions: [] })
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
    return streamOkReply({ reply: "after network", actions: [] });
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
    return streamOkReply({ reply: "after timeout fallback", actions: [] });
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
      : (fallbackSignal = init?.signal, streamOkReply({ reply: "ok", actions: [] }))
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
    return streamOkReply({ reply: "should not run", actions: [] });
  }, async (calls) => {
    await assert.rejects(() => coachChatTurn(FAKE, {}, [], "hello", user.signal));
    assert.equal(calls.length, 1);
    assert.ok(isPrimary(calls[0]));
  });
});

test("gemini 3.x chat sends thinkingLevel not thinkingBudget", async () => {
  await withFetch((url, _calls, init) => {
    if (!isPrimary(url)) return streamOkReply({ reply: "ok", actions: [] });
    assert.equal(bodyThinkingBudget(init), undefined);
    const level = parseBody(init).generationConfig?.thinkingConfig?.thinkingLevel;
    assert.equal(level, "low");
    return streamOkReply({ reply: "level ok", actions: [] });
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "level ok");
    assert.equal(calls.filter(isPrimary).length, 1);
  });
});

test("400 INVALID_ARGUMENT retries once without thinkingConfig", async () => {
  let primaryAttempts = 0;
  await withFetch((url, _calls, init) => {
    if (!isPrimary(url)) return streamOkReply({ reply: "skip", actions: [] });
    primaryAttempts += 1;
    if (primaryAttempts === 1) {
      assert.equal(bodyHasThinking(init), true);
      assert.equal(bodyThinkingBudget(init), undefined);
      return errBody(400, "Request contains an invalid argument", "INVALID_ARGUMENT");
    }
    assert.equal(bodyHasThinking(init), false);
    return streamOkReply({ reply: "after thinking retry", actions: [] });
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "after thinking retry");
    assert.equal(calls.filter(isPrimary).length, 2);
  });
});

test("after one 400 rejection the same model skips thinkingConfig on the next chat", async () => {
  let phase = 0;
  await withFetch((url, _calls, init) => {
    if (!isPrimary(url)) return streamOkReply({ reply: "skip", actions: [] });
    if (phase === 0) {
      phase = 1;
      assert.equal(bodyHasThinking(init), true);
      return errBody(400, "Request contains an invalid argument", "INVALID_ARGUMENT");
    }
    assert.equal(phase, 1);
    phase = 2;
    assert.equal(bodyHasThinking(init), false);
    return streamOkReply({ reply: "first turn ok", actions: [] });
  }, async () => {
    const first = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(first.reply, "first turn ok");
  });
  await withFetch((url, _calls, init) => {
    if (!isPrimary(url)) {
      assert.equal(bodyHasThinking(init), false);
      return streamOkReply({ reply: "second turn ok", actions: [] });
    }
    assert.equal(bodyHasThinking(init), false);
    return streamOkReply({ reply: "second turn ok", actions: [] });
  }, async (calls) => {
    const second = await coachChatTurn(FAKE, {}, [], "hello again");
    assert.equal(second.reply, "second turn ok");
    assert.equal(calls.filter(isPrimary).length, 1);
  });
});

test("two 400s on the primary model fall back to flash-lite", async () => {
  await withFetch((url) => (
    isPrimary(url)
      ? errBody(400, "Request contains an invalid argument", "INVALID_ARGUMENT")
      : streamOkReply({ reply: "lite reply", actions: [] })
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
