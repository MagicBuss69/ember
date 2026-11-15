package se.ember.app

import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
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
    }

    @PluginMethod
    fun setSnapshot(call: PluginCall) {
        val json = call.getString("json") ?: "{}"
        context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SNAPSHOT, json)
            .apply()
        EmberAlarmScheduler.reschedule(context)
        call.resolve()
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
            if (!seen.add(pkg)) continue
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
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        call.resolve()
    }
}