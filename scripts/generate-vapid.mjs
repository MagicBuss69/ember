const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
let binary = "";
for (const byte of raw) binary += String.fromCharCode(byte);
const publicKey = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const privateJwk = {
  kty: jwk.kty,
  crv: jwk.crv,
  x: jwk.x,
  y: jwk.y,
  d: jwk.d,
};

console.log("Put this in src/config.js as VAPID_PUBLIC_KEY, and in worker/wrangler.toml under [vars]:");
console.log(publicKey);
console.log("");
console.log("Then, from the worker folder, run: npx wrangler secret put VAPID_PRIVATE_JWK");
console.log("Paste this one line when asked. Do not commit it.");
console.log(JSON.stringify(privateJwk));
