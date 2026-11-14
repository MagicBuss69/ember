const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const FILES = "https://www.googleapis.com/drive/v3/files";

export { DRIVE_SCOPE };

/** Newest first. Returns ids of backups past the ones we keep. */
export function backupsToDelete(files, keep = 7) {
  const list = (files || []).filter((file) => file && file.id);
  list.sort((a, b) => {
    const left = a.createdTime || "";
    const right = b.createdTime || "";
    if (left === right) return String(b.id).localeCompare(String(a.id));
    return left < right ? 1 : -1;
  });
  return list.slice(Math.max(0, keep)).map((file) => file.id);
}

/** Drive copies leave the Gemini key and the worker token on the phone. */
export function drivePayload(state) {
  const copy = structuredClone(state);
  if (copy.settings) {
    copy.settings.geminiApiKey = "";
    copy.settings.workerToken = "";
    copy.settings.geminiKeyStatus = copy.settings.geminiApiKey ? copy.settings.geminiKeyStatus : "";
  }
  return copy;
}

export function restoreKeepingSecrets(imported, current) {
  const key = current?.settings?.geminiApiKey || "";
  const token = current?.settings?.workerToken || "";
  if (!imported.settings.geminiApiKey && key) imported.settings.geminiApiKey = key;
  if (!imported.settings.workerToken && token) imported.settings.workerToken = token;
  return imported;
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function driveError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function uploadBackup(token, state, now = new Date()) {
  const payload = drivePayload(state);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const name = `ember-backup-${stamp}.json`;
  const meta = { name, parents: ["appDataFolder"], mimeType: "application/json" };
  const boundary = `ember-${stamp}`;
  const json = JSON.stringify(payload);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(meta),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    json,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const response = await fetch(UPLOAD, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": `multipart/related; boundary=${boundary}` }),
    body,
  });
  if (!response.ok) throw driveError("Google Drive refused the backup.", response.status);
  return response.json();
}

export async function listBackups(token) {
  const url = new URL(FILES);
  url.searchParams.set("spaces", "appDataFolder");
  url.searchParams.set("q", "name contains 'ember-backup-' and trashed = false");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("fields", "files(id,name,createdTime)");
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) throw driveError("Couldn't list Drive backups.", response.status);
  const data = await response.json();
  return data.files || [];
}

export async function deleteBackup(token, id) {
  const response = await fetch(`${FILES}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!response.ok && response.status !== 404) {
    throw driveError("Couldn't remove an old Drive backup.", response.status);
  }
}

export async function downloadBackup(token, id) {
  const response = await fetch(`${FILES}/${encodeURIComponent(id)}?alt=media`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw driveError("Couldn't download that Drive backup.", response.status);
  return response.json();
}

export async function pruneBackups(token, keep = 7) {
  const files = await listBackups(token);
  const extra = backupsToDelete(files, keep);
  for (const id of extra) await deleteBackup(token, id);
  return files.length - extra.length;
}
