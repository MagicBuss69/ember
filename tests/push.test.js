import assert from "node:assert/strict";
import test from "node:test";
import { decideGeminiSave, geminiKeyEnding } from "../src/gemini.js";
import { b64urlToBytes, bytesToB64url, decryptPush, encryptPush } from "../worker/push.js";

test("a Gemini key is described by its last four characters only", () => {
  assert.equal(geminiKeyEnding("secret-key-ABCD"), "ABCD");
  assert.equal(geminiKeyEnding("  abcd  "), "abcd");
  assert.equal(geminiKeyEnding("abc"), "");
  assert.equal(decideGeminiSave({ online: false }).status, "offline");
  assert.equal(decideGeminiSave({ online: true, status: 200 }).status, "ok");
  assert.equal(decideGeminiSave({ online: true, status: 403 }).action, "reject");
  assert.equal(decideGeminiSave({ online: true, status: 429 }).status, "ok");
});

test("web push encryption round-trips for the subscriber", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = new TextEncoder().encode("Get outside for 10 minutes");
  const body = await encryptPush(bytesToB64url(rawPublic), bytesToB64url(auth), message);
  const clear = await decryptPush(body, privateJwk, bytesToB64url(auth));
  assert.equal(new TextDecoder().decode(clear), "Get outside for 10 minutes");
  assert.equal(b64urlToBytes(bytesToB64url(rawPublic)).length, rawPublic.length);
});
