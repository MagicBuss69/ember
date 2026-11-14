import { GOOGLE_CLIENT_ID } from "./config.js";
import { DRIVE_SCOPE } from "./drive.js";
import { kvGet, kvSet } from "./idb.js";

const AUTH_KEY = "drive-auth";

let token = "";
let expires = 0;
let loading = null;
let hydrated = false;

async function hydrateCachedToken() {
  if (hydrated) return;
  hydrated = true;
  try {
    const cached = await kvGet(AUTH_KEY);
    if (cached?.token && Number(cached.expires) > Date.now() && !token) {
      token = String(cached.token);
      expires = Number(cached.expires);
    }
  } catch {
    /* ignore blocked IndexedDB */
  }
}

export async function clearDriveToken() {
  token = "";
  expires = 0;
  try {
    await kvSet(AUTH_KEY, null);
  } catch {
    /* ignore */
  }
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't reach Google."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Obtain an OAuth token for `drive.appdata`.
 * Pass `prompt = ""` for silent renewal (no consent prompt if already authorized).
 * When `options.silent` is true, never falls back to interactive UI and times out cleanly.
 */
export async function requestDriveToken(prompt = "", options = {}) {
  const silent = Boolean(options.silent);
  if (!String(GOOGLE_CLIENT_ID || "").trim()) {
    throw new Error("Drive backup is not set up.");
  }
  await hydrateCachedToken();
  if (token && Date.now() < expires && !prompt) return token;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Offline.");
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = silent
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Silent Drive renewal timed out."));
        }, 12_000)
      : 0;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    const requestedPrompt = prompt ?? "";
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      prompt: requestedPrompt,
      callback: (response) => {
        if (!response || response.error || !response.access_token) {
          finish(reject, new Error("Google Drive wasn't connected."));
          return;
        }
        token = response.access_token;
        expires = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 60) * 1000;
        kvSet(AUTH_KEY, { token, expires }).catch(() => {});
        finish(resolve, token);
      },
      error_callback: () => finish(reject, new Error("Google Drive wasn't connected.")),
    });
    try {
      client.requestAccessToken({ prompt: requestedPrompt });
    } catch (error) {
      finish(reject, error);
    }
  });
}
