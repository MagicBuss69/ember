# Ember

A private self-improvement app for one person. Daily quests in the morning, afternoon, and evening, levels 1–10, a crystal shop, a workout log, and a rivals board where the opponent that matters is you, last week.

Everything stays on the phone. There is no account, no backend, and nothing to pay for. The optional week generator calls Google’s free Gemini API with a key you paste in yourself. Without a key, the rest of the app works.

Time is Europe/Stockholm. The week starts on Monday.

## Run it locally

You need Node 20 or newer.

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:43123/ember/](http://127.0.0.1:43123/ember/). `npm run build` writes a static site to `dist/`. `npm run preview` serves that build at the same `/ember/` path.

## Add it to an Android home screen

1. Deploy the `dist/` folder over HTTPS (GitHub Pages is below). Chrome will not install a PWA from a random file URL.
2. Open the site in Chrome.
3. Tap the menu and choose **Install app** or **Add to Home screen**. If Chrome offers an install banner, Ember surfaces it under **You → Install**.
4. Open Ember from the icon. It runs fullscreen and keeps working with no connection after the first load.

## Host it free on GitHub Pages

The production build is pinned to the project-site path `/ember/`, which is where GitHub Pages serves [github.com/MagicBuss69/ember](https://github.com/MagicBuss69/ember): [magicbuss69.github.io/ember/](https://magicbuss69.github.io/ember/). Vite’s `base`, the manifest `start_url` and `scope`, icon URLs, and the service worker registration all use `/ember/`.

This repo includes `.github/workflows/pages.yml`. On that repository:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main`. The workflow runs the tests, builds `dist/`, and deploys it.

Pages puts the contents of `dist/` at `/ember/`, and the built files request `/ember/assets/…`, `/ember/sw.js`, and `/ember/manifest.webmanifest`. There is a `public/.nojekyll` file so Pages does not skip any built files.

To publish by hand instead: run `npm run build`, then upload the contents of `dist/` as the Pages artifact (or push them to a `gh-pages` branch).

## Gemini key

Ember never requires a key.

1. Create a free key in [Google AI Studio](https://aistudio.google.com/apikey). No billing account is needed for the free tier.
2. In Ember, open **You** and paste it under Gemini, or paste it in the **Generate this week** sheet on the Week tab.
3. The key is stored only in this phone’s IndexedDB (and the localStorage mirror). It is included in a JSON backup. Don’t post that file anywhere.
4. Tap **Generate this week**. Ember asks `gemini-2.5-flash` first and falls back to `gemini-flash-latest` if that model id is gone. Both are free-tier Flash models. Your goals text is the only thing sent, and only when you tap the button. Google’s free tier may use that text to improve Google’s products.
5. You get a preview. Nothing changes until you tap **Use this plan**. Days you have already started are left alone.

If you are offline, or the free tier rate-limits you, the week you already have stays as it is.

## What the three parts do

**Today** is a quest list split into Morning, Afternoon, and Evening. Add, edit, and tick quests. A tick pops `+25 XP`, fills the level bar, and can play the level-up. The ring is how much of today is done. The streak counts days with at least one finished quest and breaks after a Stockholm day with none. A workout does not save the streak.

**Week** edits this week, or the template that repeats. **Save {weekday} to the template** copies that day. **Fill open days** copies the template onto days with no finished quest.

**Train** logs a lift (sets, reps, kilograms, weight can be 0) or a run (minutes and kilometres). Each saved session is `+40 XP`. You get history per exercise and this week’s sessions, tonnage, kilometres, and minutes.

**You** holds the level, the crystal shop, goals, the Gemini key, reminders, and backup.

## Crystals

A second currency, shown on the gem at the top.

- A day with at least one finished quest: 1
- A day where every quest is done: 3
- Reaching a new level: 6
- A streak that hits 7, 14, or 30 days: 4, 6, or 10

Spend them on a streak freeze (16) or a theme (Pine and Frost are 10, Ink is 14). A freeze repairs a gap only when you own enough freezes for every missed day in that gap, so one freeze is not wasted on a three-day hole. Unchecking a quest gives the XP and the day crystals back. Level crystals stay.

## Rivals

No server and no other people.

The top of the tab is your past self: last week’s same weekday (“You’re 40 XP ahead of last Friday’s you”), this week against last week’s pace, and your best week. Those numbers are your own XP.

Under that, Leo, Maja, Noah, and Amina are simulated on this phone. They have names, cities, portraits, levels near yours, streaks that break, and uneven weeks. Their days are a hash of the date, saved on the device, so reloading does not reshuffle them. The activity lines (“Leo just finished a workout”) only appear after the time of day they were given. A line at the bottom of the tab says they are not accounts.

## Backup

**You → Export backup** downloads `ember-backup-YYYY-MM-DD.json`. **Import backup** replaces what is on this phone. The file holds quests, XP, workouts, crystals, the simulated rivals’ history, and the Gemini key if you saved one.

## Reminders, and the real limits

Each quest can have a time. Ember then does the best thing a free PWA can do on Android Chrome in 2026. It cannot promise 07:30 with the app closed.

What actually ships in Chrome:

- **While Ember is open**, a timer fires the notification at the minute you set. This is exact.
- **The next time you open Ember**, any reminder that came due today and was not shown yet is shown immediately. This always works. It does not reach you while the app is closed.
- **Notification Triggers** (`TimestampTrigger` / `showTrigger`) would schedule an exact local alarm with no server. Chrome ran origin trials in versions 80–83 and 86–88 and then stopped. The feature was never launched. It still exists only behind `chrome://flags/#enable-experimental-web-platform-features`. Ember uses it when `TimestampTrigger` exists, and does not pass `showTrigger` otherwise, because an unknown option is ignored and the notification would show immediately.
- **Periodic Background Sync** is the only background path that does not need a server. Ember registers it after you allow notifications. Chrome only allows it for an installed PWA, and the shortest gap it will actually use is **12 hours**, longer when you have not been opening the app (often 24 or 36 hours). Android can delay it further to save battery. It might surface a quest you missed. It will not hit 07:30.
- **Web Push** can be more timely, and it needs a server to send the push. Ember does not have one.

So: set the time, allow notifications, and install the app. You will be nudged at the right minute if Ember is on screen, and you will be caught up when you next open it. Treat a closed-app notification as a bonus, not a clock.

Sources: [Notification Triggers](https://developer.chrome.com/docs/web-platform/notification-triggers) (development ended, launch not started), [Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync), and Chromium’s 12-hour floor in [`background_sync_parameters.cc`](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/browser/background_sync_parameters.cc) (`kMinPeriodicSyncEventsInterval`).

## Data

IndexedDB (`ember`) is the store. A localStorage mirror (`ember-state`) is written too, so a private-mode browser that blocks IndexedDB still keeps the app. The service worker reads the reminder list from IndexedDB, which is why the primary store is not localStorage alone. Clearing the site’s data in Chrome deletes all of it. Export first if that would hurt.

## Project map

- `src/domain.js` — quests, XP, streaks, crystals, workouts
- `src/rivals.js` — past-self comparisons and the simulated people
- `src/notify.js` and `public/sw.js` — reminders and the offline cache
- `src/gemini.js` — optional week generation
- `src/ui/` — screens
- `tests/` — `npm test`
