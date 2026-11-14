import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/domain.js";
import { backupsToDelete, drivePayload, restoreKeepingSecrets } from "../src/drive.js";

test("keeps the seven newest Drive backups", () => {
  const files = Array.from({ length: 10 }, (_, index) => ({
    id: `id${index}`,
    createdTime: `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  assert.deepEqual(backupsToDelete(files, 7), ["id2", "id1", "id0"]);
  assert.deepEqual(backupsToDelete(files.slice(0, 3), 7), []);
  assert.deepEqual(backupsToDelete([], 7), []);
});

test("Drive payload drops the Gemini key and the worker token", () => {
  const state = createInitialState(new Date("2026-11-13T12:00:00Z"));
  state.settings.geminiApiKey = "secret-key-ABCD";
  state.settings.workerToken = "worker-secret-token";
  state.settings.geminiKeyStatus = "ok";
  const payload = drivePayload(state);
  assert.equal(payload.settings.geminiApiKey, "");
  assert.equal(payload.settings.workerToken, "");
  assert.equal(state.settings.geminiApiKey, "secret-key-ABCD");
  assert.equal(JSON.stringify(payload).includes("secret-key-ABCD"), false);
  assert.equal(JSON.stringify(payload).includes("worker-secret-token"), false);
  const restored = restoreKeepingSecrets(payload, state);
  assert.equal(restored.settings.geminiApiKey, "secret-key-ABCD");
  assert.equal(restored.settings.workerToken, "worker-secret-token");
});
