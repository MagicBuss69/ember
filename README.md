# Ember

A private self-improvement app for one person. Daily quests in the morning, afternoon, and evening, levels 1–10, a crystal shop, a workout log, and a rivals board where the opponent that matters is you, last week.

Everything stays private to you and costs $0. There is no paid service and no card needed anywhere. Optional pieces—Gemini week generation, auto-backup to your own Google Drive (`appDataFolder`), and closed-app reminders via your own free Cloudflare Worker—turn on only when you fill in their keys. Without any of them, Ember works completely offline on your phone.

Time is `Europe/Stockholm`. The week starts on Monday.

## Run it locally

You need Node 20 or newer.

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:43123/ember/](http://127.0.0.1:43123/ember/). `npm run build` writes a static site to `dist/`. `npm run preview` serves that build at the same `/ember/` path.

## Install as a real app on Android (WebAPK, no Chrome badge)

Ember’s manifest (`id`, `start_url`, and `scope` all `/ember/`, `display: standalone`, opaque 192×192 and 512×512 `any` icons plus a separate `maskable` icon, narrow 390×844 screenshots, description) and offline-capable service worker meet Chrome’s WebAPK criteria—so Android installs a real standalone app without a Chrome badge on the icon or an address bar inside.

1. Open [https://magicbuss69.github.io/ember/](https://magicbuss69.github.io/ember/) in Chrome on Android.
2. If you previously added an older **shortcut** (`Installera genväg` with the small Chrome badge), remove that icon from the home screen first.
3. Reload the page once, then tap **You → Install → Install Ember** (uses Chrome’s `beforeinstallprompt`), or open Chrome’s menu and tap **Install app** (`Installera app`). If Chrome briefly shows `Installera genväg` before the service worker finishes caching on the very first visit, wait two seconds, reload once, and open the menu again—it switches to **Installera app**.
4. Open Ember from the new app icon. It runs fullscreen and offline, and Google Translate won’t pop up (`lang="en"`, `translate="no"`, `<meta name="google" content="notranslate">`).

## Host it free on GitHub Pages

The production build is pinned to `/ember/`, where GitHub Pages serves [github.com/MagicBuss69/ember](https://github.com/MagicBuss69/ember) at [magicbuss69.github.io/ember/](https://magicbuss69.github.io/ember/).

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main`. `.github/workflows/pages.yml` runs `npm test`, builds `dist/`, and deploys it.

`public/.nojekyll` keeps GitHub Pages from ignoring underscored files.

## Gemini key (optional)

Ember works without a key.

1. Create a free key in [Google AI Studio](https://aistudio.google.com/apikey) (no billing account needed on the free tier).
2. Open **You → Gemini**, paste the key, and tap **Save** (use **Show** / **Hide** to check what you pasted).
3. On save, Ember runs a tiny `models?pageSize=1` check against Gemini. When it passes, the card switches to `Saved ✓ · Key works · ending …abcd` with **Replace** and **Remove** buttons (**Remove** asks to confirm). If the key is rejected, Ember shows a friendly message and leaves your previous state untouched; if you’re offline, it still lets you save and marks it unchecked. The key is never logged.
4. Tap **Generate this week** on the Week tab to preview a 7-day plan from your goals. Nothing changes until you tap **Use this plan**, and days you already started stay untouched.

## Auto-backup to your own Google Drive ($0, no server)

Ember can back up straight from your phone into Google Drive’s hidden `appDataFolder` using Google Identity Services in the browser. Only Ember can see that folder, no server sits in the middle, your Gemini key and worker token are stripped out automatically, and Ember keeps the latest **7** backups (once a day automatically on open after you connect, plus **Back up now** and **Restore from Drive** in **You**). If `GOOGLE_CLIENT_ID` in `src/config.js` is empty, the Drive section stays hidden.

### One-time Google Cloud Console setup (free, no card)

1. Open [console.cloud.google.com](https://console.cloud.google.com/) signed in with Mag’s Google account and create a new project (for example `ember-personal`). Do **not** enable billing.
2. Go to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Go to **Google Auth Platform** (or **APIs & Services → OAuth consent screen**):
   - Choose **External**, click **Create**.
   - Fill in app name `Ember`, your email for support and developer contact, and click **Save and continue**.
   - On **Data Access / Scopes**, click **Add or remove scopes**, add `https://www.googleapis.com/auth/drive.appdata` (`.../auth/drive.appdata`), and save.
   - On **Audience / Test users**, keep publishing status in **Testing** and add **Mag’s Gmail address** under **Test users**. (Leaving it in Testing avoids Google’s app verification process and is free forever for listed test users.)
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Ember GitHub Pages`.
   - Under **Authorized JavaScript origins**, add `https://magicbuss69.github.io` (and `http://127.0.0.1:43123` if you also want to test locally). Leave redirect URIs empty—the token flow doesn’t use them.
   - Click **Create** and copy the **Client ID** (ends with `.apps.googleusercontent.com`). Ignore the client secret; never put a client secret in frontend code.
5. Put that Client ID into `src/config.js`:

```js
export const GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
```

6. Commit and push to `main` so GitHub Pages rebuilds, then open **You → Google Drive → Connect Google Drive** once on the phone.

## Closed-app notifications via a free Cloudflare Worker ($0, no card)

Android Chrome cannot fire an exact local alarm while a PWA is closed without Web Push ([Notification Triggers](https://developer.chrome.com/docs/web-platform/notification-triggers) never shipped, and [Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync) has a 12-hour minimum floor in Chromium). To get exact-minute reminders with Ember closed at $0, `/worker` holds a tiny Cloudflare Worker you deploy to your own free Cloudflare account (Workers Free plan + KV Free tier + Cron Triggers—no credit card required).

The Worker stores **only** your Web Push subscription and your reminder schedule (`label`, `HH:MM`, `Europe/Stockholm`, enabled weekdays / skip dates) in Workers KV, checks once a minute via a Cron Trigger, and sends an encrypted VAPID Web Push with Web Crypto when a quest is due. All endpoints require a shared `Bearer` token stored only on your phone. If `WORKER_URL` or `VAPID_PUBLIC_KEY` in `src/config.js` is empty, Ember quietly falls back to open-app + next-open reminders.

### Exact deploy steps

1. Sign up for a free Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up/workers-and-pages) (Workers Free, no card).
2. Generate your VAPID keypair locally in this repo:

```bash
node scripts/generate-vapid.mjs
```

   Keep the terminal output open—it prints the public key and a one-line private JWK.
3. Log in with Wrangler and create the free KV namespace from the `worker/` folder:

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create EMBER
```

4. Copy the `id` Wrangler prints into `worker/wrangler.toml` (replacing `REPLACE_WITH_KV_NAMESPACE_ID`), and paste the VAPID public key from step 2 into `VAPID_PUBLIC_KEY` under `[vars]` in `worker/wrangler.toml`.
5. Choose a strong random shared token (for example `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`) and upload the two secrets to Cloudflare (still inside `worker/`):

```bash
npx wrangler secret put VAPID_PRIVATE_JWK
# paste the one-line JSON private key from step 2

npx wrangler secret put EMBER_TOKEN
# paste your random shared token
```

6. Deploy the Worker:

```bash
npx wrangler deploy
```

   Wrangler prints your URL, like `https://ember-reminders.<your-subdomain>.workers.dev`.
7. Put that URL and the same VAPID public key into `src/config.js`:

```js
export const WORKER_URL = "https://ember-reminders.<your-subdomain>.workers.dev";
export const VAPID_PUBLIC_KEY = "<public key from step 2>";
```

8. Commit and push to `main`. Once Pages deploys, open Ember on the phone → **You → Reminders**, paste your `EMBER_TOKEN` into **Worker token**, and tap **Turn on closed-app reminders**. Any time you add, edit, move, or tick off a quest, Ember syncs the updated schedule to your Worker; tapping a notification opens Ember right on Today.

## What the tabs do

- **Today** — Morning, Afternoon, and Evening quest checklist. Ticking a quest pops `+25 XP`, fills the level bar, and plays a level-up from 1 to 10. Drag any quest by its right-hand grip—or tap **Reorder** to use up/down arrows—to reorder quests or move them between Morning, Afternoon, and Evening.
- **Week** — Edit this week or the repeating template, or generate a week with Gemini.
- **Train** — Log lifts (sets, reps, kg) or runs (minutes, km) for `+40 XP`, per-exercise history, and weekly volume stats.
- **Rivals** — Compete against your past self first (same weekday last week, last week’s pace, best week), plus four on-device simulated partners with realistic streaks and uneven weeks.
- **You** — Level medallion, crystal shop (streak freezes + Pine, Frost, Ink themes), goals, Gemini key card, Reminders, JSON export/import, Google Drive auto-backup, and Install.

## Project map

- `src/config.js` — `GOOGLE_CLIENT_ID`, `WORKER_URL`, `VAPID_PUBLIC_KEY`
- `src/domain.js` — quests (including drag/step reorder), XP, streaks, crystals, workouts
- `src/drive.js` & `src/driveAuth.js` — client-side Google Drive `appDataFolder` backup + 7-backup retention
- `src/due.js`, `src/schedule.js`, `src/pushClient.js` — reminder schedule & due-time matching shared with the Worker
- `worker/` — Cloudflare Worker (`index.js`, `push.js`, `wrangler.toml`)
- `scripts/generate-vapid.mjs` — zero-dependency VAPID key generator
- `tests/` — `npm test`
