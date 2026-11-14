import { dueReminders } from "../src/due.js";
import { sendWebPush } from "./push.js";

const ALLOWED = new Set([
  "https://magicbuss69.github.io",
  "http://127.0.0.1:43123",
  "http://localhost:43123",
]);

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED.has(origin) ? origin : "https://magicbuss69.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(request) },
  });
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(env.EMBER_TOKEN) && token === env.EMBER_TOKEN;
}

function pruneSent(sent) {
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const next = {};
  for (const [key, at] of Object.entries(sent || {})) {
    if (Number(at) >= cutoff) next[key] = at;
  }
  return next;
}

async function deliverDue(env, now = new Date()) {
  const subscription = await env.EMBER.get("subscription", "json");
  const schedule = await env.EMBER.get("schedule", "json");
  if (!subscription?.endpoint || !schedule?.reminders) return 0;
  const stored = (await env.EMBER.get("sent", "json")) || {};
  const sent = pruneSent(stored);
  const due = dueReminders(schedule, now, sent);
  if (!due.length) {
    if (Object.keys(sent).length !== Object.keys(stored).length) {
      await env.EMBER.put("sent", JSON.stringify(sent));
    }
    return 0;
  }
  const privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  for (const item of due) {
    await sendWebPush(subscription, {
      title: item.label,
      body: `${item.time} · Stockholm`,
      tag: item.key,
      date: item.date,
    }, privateJwk, env.VAPID_PUBLIC_KEY);
    sent[item.key] = Date.now();
  }
  await env.EMBER.put("sent", JSON.stringify(sent));
  return due.length;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(request, { ok: true, service: "ember-reminders" });
    }
    if (!authorized(request, env)) return json(request, { error: "Unauthorized." }, 401);
    if (request.method === "POST" && url.pathname === "/api/subscribe") {
      const body = await request.json();
      if (!body?.subscription?.endpoint || !body.subscription.keys?.p256dh || !body.subscription.keys?.auth) {
        return json(request, { error: "Missing push subscription." }, 400);
      }
      await env.EMBER.put("subscription", JSON.stringify(body.subscription));
      if (body.schedule) await env.EMBER.put("schedule", JSON.stringify(body.schedule));
      return json(request, { ok: true });
    }
    if (request.method === "PUT" && url.pathname === "/api/schedule") {
      const schedule = await request.json();
      if (!schedule || !Array.isArray(schedule.reminders)) {
        return json(request, { error: "Missing reminders." }, 400);
      }
      schedule.timezone = "Europe/Stockholm";
      await env.EMBER.put("schedule", JSON.stringify(schedule));
      return json(request, { ok: true });
    }
    if (request.method === "DELETE" && url.pathname === "/api/subscribe") {
      await env.EMBER.delete("subscription");
      await env.EMBER.delete("schedule");
      return json(request, { ok: true });
    }
    return json(request, { error: "Not found." }, 404);
  },

  async scheduled(_event, env) {
    await deliverDue(env, new Date());
  },
};
