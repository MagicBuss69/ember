package se.ember.app

import android.app.NotificationManager
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "EmberBlocker")
class EmberBlockerPlugin : Plugin() {

    companion object {
        const val PREFS = "ember_blocker"
        const val KEY_SNAPSHOT = "snapshot_json"
        const val KEY_UNLOCKS = "unlocks_json"
    }

    @PluginMethod
    fun setSnapshot(call: PluginCall) {
        val json = call.getString("json") ?: "{}"
        context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SNAPSHOT, json)
            .commit()
        EmberAlarmScheduler.reschedule(context)
        call.resolve()
    }

    /**
     * Real-life reward unlock: opens every blocked app for `minutes`, on top of any
     * unlock still running. Same per-app windows as the push-up unlock, so the
     * accessibility watch, the expiry alarm, and the relock all apply.
     */
    @PluginMethod
    fun grantUnlock(call: PluginCall) {
        val minutes = (call.getInt("minutes") ?: 0).coerceIn(0, 240)
        if (minutes <= 0) {
            call.reject("No unlock minutes.")
            return
        }
        val reason = call.getString("reason") ?: "reward"
        val snap = BlockerSnapshot.read(context)
        val now = System.currentTimeMillis()
        val until = BlockerSnapshot.grantRewardUnlock(context, snap.packages, minutes * 60_000L, now)
        android.util.Log.i(EmberBlockLog.TAG, "reward unlock ${minutes}m for ${snap.packages.size} apps ($reason)")
        val event = org.json.JSONObject()
        event.put("type", "reward-unlock")
        event.put("until", java.time.Instant.ofEpochMilli(until).toString())
        event.put("minutes", minutes)
        EmberInbox.appendEvent(context, event)
        val result = JSObject()
        result.put("until", java.time.Instant.ofEpochMilli(until).toString())
        result.put("packages", snap.packages.size)
        call.resolve(result)
    }

    @PluginMethod
    fun listLaunchableApps(call: PluginCall) {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL)
        val out = JSArray()
        val seen = HashSet<String>()
        for (info in resolved) {
            val pkg = info.activityInfo.packageName
            if (pkg == context.packageName || !seen.add(pkg)) continue
            val row = JSObject()
            row.put("id", pkg)
            row.put("label", info.loadLabel(pm)?.toString() ?: pkg)
            out.put(row)
        }
        val result = JSObject()
        result.put("apps", out)
        call.resolve(result)
    }

    @PluginMethod
    fun drainInbox(call: PluginCall) {
        val events = EmberInbox.drain(context)
        val result = JSObject()
        result.put("events", events)
        call.resolve(result)
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val host = activity
        if (host != null) host.startActivity(intent) else context.startActivity(intent)
        call.resolve()
    }

    /** WebView download clicks are ignored, so the APK exports through the share sheet. */
    @PluginMethod
    fun readSnapshot(call: PluginCall) {
        val raw = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .getString(KEY_SNAPSHOT, "{}") ?: "{}"
        val result = JSObject()
        result.put("json", raw)
        call.resolve(result)
    }

    @PluginMethod
    fun consumeOpenIntent(call: PluginCall) {
        val intent = activity?.intent
        val open = intent?.getBooleanExtra("ember_open_challenge", false) == true
        val confirm = intent?.getBooleanExtra("ember_confirm_challenge", false) == true
        intent?.removeExtra("ember_open_challenge")
        intent?.removeExtra("ember_confirm_challenge")
        val result = JSObject()
        result.put("openChallenge", open)
        result.put("confirmChallenge", confirm)
        call.resolve(result)
    }

    @PluginMethod
    fun blockerPermissions(call: PluginCall) {
        val overlays = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)
        val fullScreen = if (Build.VERSION.SDK_INT >= 34) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.canUseFullScreenIntent()
        } else {
            true
        }
        val result = JSObject()
        result.put("overlay", overlays)
        result.put("fullScreen", fullScreen)
        call.resolve(result)
    }

    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun openFullScreenSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 34) {
            val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun startPushupTest(call: PluginCall) {
        val host = activity
        if (host == null) {
            call.reject("Ember isn't in the foreground.")
            return
        }
        val intent = Intent(host, PushupActivity::class.java)
            .putExtra(PushupActivity.EXTRA_PRACTICE, true)
            .addFlags(EmberGate.gateFlags())
        host.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun shareBackup(call: PluginCall) {
        val rawName = call.getString("filename") ?: "ember-backup.json"
        val text = call.getString("text") ?: ""
        val safe = rawName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "ember-backup.json" }
        val host = activity
        if (host == null) {
            call.reject("Ember isn't in the foreground.")
            return
        }
        try {
            val file = java.io.File(context.cacheDir, safe)
            file.writeText(text)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, safe)
                clipData = ClipData.newRawUri(safe, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "Export backup")
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            host.startActivity(chooser)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Couldn't share the backup.")
        }
    }
}