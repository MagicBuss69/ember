function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToB64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat([info, new Uint8Array([1])]));
  return okm.slice(0, length);
}

const text = (value) => new TextEncoder().encode(value);

/** RFC 8291 aes128gcm body for one Web Push message. */
export async function encryptPush(userPublicB64, authB64, payloadBytes) {
  const userPublicKey = b64urlToBytes(userPublicB64);
  const authSecret = b64urlToBytes(authB64);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const subscriber = await crypto.subtle.importKey(
    "raw",
    userPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriber },
    local.privateKey,
    256,
  ));
  const ikm = await hkdf(
    authSecret,
    shared,
    concat([text("WebPush: info\0"), userPublicKey, localPublic]),
    32,
  );
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const record = concat([payloadBytes, new Uint8Array([2])]);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));
  const header = new Uint8Array(21 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return concat([header, cipher]);
}

/** Test helper. The worker only encrypts. */
export async function decryptPush(body, recipientPrivate, authB64) {
  const authSecret = b64urlToBytes(authB64);
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const senderPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    recipientPrivate,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const sender = await crypto.subtle.importKey(
    "raw",
    senderPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: sender },
    privateKey,
    256,
  ));
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey(
    "raw",
    await crypto.subtle.importKey(
      "jwk",
      { kty: recipientPrivate.kty, crv: recipientPrivate.crv, x: recipientPrivate.x, y: recipientPrivate.y },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    ),
  ));
  const ikm = await hkdf(
    authSecret,
    shared,
    concat([text("WebPush: info\0"), rawPublic, senderPublic]),
    32,
  );
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, cipher));
  let end = clear.length;
  while (end > 0 && clear[end - 1] === 0) end -= 1;
  if (clear[end - 1] !== 2) throw new Error("Bad push padding.");
  return clear.slice(0, end - 1);
}

export async function vapidAuthorization(endpoint, privateJwk, publicKeyB64) {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(text(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:ember@localhost",
  })));
  const unsigned = text(`${header}.${payload}`);
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, unsigned));
  const jwt = `${header}.${payload}.${bytesToB64url(signature)}`;
  return {
    Authorization: `vapid t=${jwt}, k=${publicKeyB64}`,
    "Crypto-Key": `p256ecdsa=${publicKeyB64}`,
  };
}

export async function sendWebPush(subscription, message, privateJwk, publicKeyB64) {
  const payload = text(JSON.stringify(message));
  const body = await encryptPush(subscription.keys.p256dh, subscription.keys.auth, payload);
  const headers = await vapidAuthorization(subscription.endpoint, privateJwk, publicKeyB64);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      ...headers,
      TTL: "120",
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!response.ok && response.status !== 201 && response.status !== 202) {
    throw new Error(`Push service returned ${response.status}.`);
  }
}
