import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_GEMINI_FALLBACK_MODEL, CHAT_GEMINI_MODEL } from "../src/constants.js";
import {
  coachChatTurn,
  coachStreamDisplayText,
  createSseDeltaParser,
  decodePartialJsonStringContent,
  readStreamText,
  resetThinkingConfigRejections,
  textDeltaFromSseData,
} from "../src/gemini.js";

const FAKE = "test-key-do-not-log";

function sseLine(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream };
}

function errBody(status, message, apiStatus = "") {
  return { ok: false, status, json: async () => ({ error: { code: status, message, status: apiStatus } }) };
}

function streamReply(replyObj, pieces) {
  const chunks = pieces.map((text) =>
    sseLine({ candidates: [{ content: { parts: [{ text }] } }] }),
  );
  chunks.push(sseLine({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] }));
  const full = JSON.stringify(replyObj);
  if (!pieces.length) chunks.unshift(sseLine({ candidates: [{ content: { parts: [{ text: full }] } }] }));
  return sseResponse(chunks);
}

function isPrimary(url) {
  return url.includes(CHAT_GEMINI_MODEL) && !url.includes(CHAT_GEMINI_FALLBACK_MODEL);
}

function isStream(url) {
  return url.includes("streamGenerateContent");
}

async function withFetch(handler, run) {
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ href, init });
    return handler(href, calls, init);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = prev;
  }
}

test.beforeEach(() => {
  resetThinkingConfigRejections();
});

test("textDeltaFromSseData ignores empty and malformed payloads", () => {
  assert.equal(textDeltaFromSseData(""), "");
  assert.equal(textDeltaFromSseData("[DONE]"), "");
  assert.equal(textDeltaFromSseData("not-json"), "");
});

test("createSseDeltaParser splits data across reads and handles multiple events", () => {
  const parser = createSseDeltaParser();
  const deltas = [];
  const emit = (d) => deltas.push(d);
  parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"Hel', emit);
  parser.feed('lo"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"!"}]}}]}\n\n', emit);
  parser.finish(emit);
  assert.deepEqual(deltas, ["Hello", "!"]);
});

test("createSseDeltaParser handles blank lines and a final partial line", () => {
  const parser = createSseDeltaParser();
  const deltas = [];
  parser.feed(
    '\ndata: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}\n\n',
    (d) => deltas.push(d),
  );
  parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"B"}]}}]}', (d) => deltas.push(d));
  parser.finish((d) => deltas.push(d));
  assert.deepEqual(deltas, ["A", "B"]);
});

test("primary stream failure before first chunk falls back to flash-lite", async () => {
  const reply = { reply: "lite stream", actions: [] };
  await withFetch((url) => {
    if (isPrimary(url) && isStream(url)) return errBody(503, "high demand", "UNAVAILABLE");
    if (url.includes(CHAT_GEMINI_FALLBACK_MODEL)) {
      return streamReply(reply, ['{"reply":"lite stream","actions":[]}']);
    }
    throw new Error(`unexpected ${url}`);
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello");
    assert.equal(result.reply, "lite stream");
    assert.equal(calls.filter((c) => isPrimary(c.href)).length, 1);
    assert.equal(calls.filter((c) => c.href.includes(CHAT_GEMINI_FALLBACK_MODEL)).length, 1);
  });
});

test("mid-stream failure keeps partial text without fallback", async () => {
  const encoder = new TextEncoder();
  let call = 0;
  await withFetch((url) => {
    if (!isPrimary(url) || !isStream(url)) throw new Error("no fallback expected");
    call += 1;
    if (call === 1) {
      let reads = 0;
      const stream = new ReadableStream({
        pull(controller) {
          reads += 1;
          if (reads === 1) {
            controller.enqueue(
              encoder.encode(sseLine({ candidates: [{ content: { parts: [{ text: '{"reply":"Part' }] } }] })),
            );
            return;
          }
          controller.error(new TypeError("connection dropped"));
        },
      });
      return { ok: true, status: 200, body: stream };
    }
    throw new Error("fallback should not run");
  }, async (calls) => {
    await assert.rejects(
      () => coachChatTurn(FAKE, {}, [], "hello"),
      (error) => {
        assert.match(error.partialText || "", /Part/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });
});

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

test("pre-first-chunk stream read failure falls back to flash-lite", async () => {
  await withFetch((url) => {
    if (isPrimary(url) && isStream(url)) {
      const stream = new ReadableStream({
        pull() {
          return Promise.reject(new DOMException("signal timed out", "TimeoutError"));
        },
      });
      return { ok: true, status: 200, body: stream };
    }
    if (url.includes(CHAT_GEMINI_FALLBACK_MODEL)) {
      return streamOkReply({ reply: "after stalled read", actions: [] });
    }
    throw new Error(url);
  }, async (calls) => {
    const result = await coachChatTurn(FAKE, {}, [], "hello", AbortSignal.timeout(45000));
    assert.equal(result.reply, "after stalled read");
    assert.equal(calls.filter((c) => isPrimary(c.href)).length, 1);
    assert.equal(calls.filter((c) => c.href.includes(CHAT_GEMINI_FALLBACK_MODEL)).length, 1);
  });
});

test("coachStreamDisplayText keeps escaped backslash before n", () => {
  const buffer = '{"reply":"use \\\\n not a newline';
  assert.equal(coachStreamDisplayText(buffer), "use \\n not a newline");
});

test("coachStreamDisplayText uses the top-level reply before actions, not nested reply fields", () => {
  const buffer = '{"reply":"Hello there","actions":[{"reply":"wrong"}]';
  assert.equal(coachStreamDisplayText(buffer), "Hello there");
});

test("readStreamText flushes the last chunk when the reader ends with done", async () => {
  const encoder = new TextEncoder();
  const payload = sseLine({ candidates: [{ content: { parts: [{ text: '{"reply":"Done"}' }] } }] });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, 20)));
      controller.enqueue(encoder.encode(payload.slice(20)));
      controller.close();
    },
  });
  const text = await readStreamText({ body: stream });
  assert.match(text, /"reply":"Done"/);
});

test("readStreamText decodes utf8 split across the final stream read", async () => {
  const encoder = new TextEncoder();
  const emoji = "🙂";
  const bytes = encoder.encode(
    sseLine({ candidates: [{ content: { parts: [{ text: `{"reply":"${emoji}"}` }] } }] }),
  );
  const split = bytes.length - 2;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
  const text = await readStreamText({ body: stream });
  assert.ok(text.includes(emoji), text);
});

test("decodePartialJsonStringContent drops an incomplete trailing unicode escape", () => {
  assert.equal(decodePartialJsonStringContent("hi\\u00"), "hi");
  assert.equal(decodePartialJsonStringContent("trail\\"), "trail");
});

test("bad API key does not retry or fall back on stream", async () => {
  await withFetch((url) => {
    if (isStream(url)) return errBody(400, `API key ${FAKE} not valid`, "INVALID_ARGUMENT");
    throw new Error(url);
  }, async (calls) => {
    await assert.rejects(
      () => coachChatTurn(FAKE, {}, [], "hello"),
      (error) => {
        assert.equal(error.message.includes(FAKE), false);
        assert.match(error.message, /refused|key/i);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls.some((c) => c.href.includes(CHAT_GEMINI_FALLBACK_MODEL)), false);
  });
});