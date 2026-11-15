import assert from "node:assert/strict";
import test from "node:test";

test("silent requestDriveToken never calls requestAccessToken without a cached token", async () => {
  let accessTokenCalls = 0;
  const prevGoogle = globalThis.google;
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient: () => ({
          requestAccessToken: () => {
            accessTokenCalls += 1;
          },
        }),
      },
    },
  };
  try {
    const { clearDriveToken, requestDriveToken } = await import(`../src/driveAuth.js?${Date.now()}`);
    await clearDriveToken();
    await assert.rejects(
      () => requestDriveToken("", { silent: true }),
      (error) => {
        assert.match(error.message, /not cached/i);
        return true;
      },
    );
    assert.equal(accessTokenCalls, 0);
  } finally {
    globalThis.google = prevGoogle;
  }
});