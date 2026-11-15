# Ember Android (sideload)

Ember v3 ships as a Capacitor wrapper around the same Vite build used on the web. This is **not** a Play Store build.

## Prerequisites

- Node 20+ (`npm install`, `npm run build`)
- Android SDK (API 34+) and JDK 17
- `ANDROID_HOME` set; `sdkmanager` / platform tools on `PATH`

## Debug APK

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Install: `adb install -r app/build/outputs/apk/debug/app-debug.apk`

## Signed release APK

1. Create a **local** keystore (never commit it):

   ```bash
   keytool -genkey -v -keystore ember-release.keystore -alias ember -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add `android/keystore.properties` (gitignored) with:

   ```properties
   storeFile=../ember-release.keystore
   storePassword=...
   keyAlias=ember
   keyPassword=...
   ```

3. Wire signing in `android/app/build.gradle` (release `signingConfig`), then:

   ```bash
   ./gradlew assembleRelease
   ```

   Output: `app/build/outputs/apk/release/app-release.apk`

4. On device: enable **Install unknown apps** for your file manager, transfer the APK, install.

## After install

1. Open Ember once so the web shell loads.
2. **Settings → Android blocker → Open accessibility settings**, enable **Ember**.
3. On **Android 13+** sideloads: **App info → ⋮ → Allow restricted settings** before the accessibility toggle will stick.
4. Grant **Alarms & reminders** if prompted (exact alarms for challenge rolls and deadlines).
5. Optional: pick blocked apps in Settings (uses `QUERY_ALL_PACKAGES`).

## What only a phone verifies

- Accessibility blocking (HOME + full-screen block activity)
- Exact alarms while the app is killed
- Foreground service notification during an open challenge