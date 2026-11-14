import { GOOGLE_CLIENT_ID } from "./config.js";
import { DRIVE_SCOPE } from "./drive.js";

let token = "";
let expires = 0;
let loading = null;

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

export function requestDriveToken(prompt) {
  if (!String(GOOGLE_CLIENT_ID || "").trim()) {
    return Promise.reject(new Error("Drive backup is not set up."));
  }
  if (token && Date.now() < expires && !prompt) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    loadGis().then(() => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (!response || response.error || !response.access_token) {
            reject(new Error("Google Drive wasn't connected."));
            return;
          }
          token = response.access_token;
          expires = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
          resolve(token);
        },
        error_callback: () => reject(new Error("Google Drive wasn't connected.")),
      });
      client.requestAccessToken({ prompt: prompt || "" });
    }).catch(reject);
  });
}
