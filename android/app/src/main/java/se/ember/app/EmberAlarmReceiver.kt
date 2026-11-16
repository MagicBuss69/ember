package se.ember.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class EmberAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        try {
            handle(context, intent, action)
        } catch (error: Exception) {
            android.util.Log.i(EmberBlockLog.TAG, "alarm $action failed: ${error.javaClass.simpleName}")
        }
    }

    private fun handle(context: Context, intent: Intent, action: String) {
        when (action) {
            EmberAlarmScheduler.ACTION_ROLL -> {
                EmberInbox.append(context, "native-roll")
                openEmber(context)
            }
            EmberAlarmScheduler.ACTION_DEADLINE -> {
                val snap = BlockerSnapshot.read(context)
                val id = readChallengeId(context)
                EmberInbox.append(context, "miss", if (id.isNotBlank()) id else "deadline")
                if (snap.challengeActive) openEmber(context)
            }
            EmberAlarmScheduler.ACTION_UNLOCK_EXPIRE -> EmberUnlockLoop.onExpired(context)
            EmberAlarmScheduler.ACTION_UNLOCK_WARN -> {
                val pkg = intent.getStringExtra(EmberAlarmScheduler.EXTRA_PACKAGE) ?: ""
                if (pkg.isNotBlank()) EmberUnlockLoop.showWarning(context, pkg)
            }
        }
        EmberAlarmScheduler.reschedule(context)
    }

    private fun readChallengeId(context: Context): String {
        val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(EmberBlockerPlugin.KEY_SNAPSHOT, "{}") ?: "{}"
        return try {
            org.json.JSONObject(raw).optString("challengeId", "")
        } catch (_: Exception) {
            ""
        }
    }

    private fun openEmber(context: Context) {
        val main = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("ember_open_challenge", true)
        try {
            context.startActivity(main)
        } catch (error: Exception) {
            android.util.Log.i(EmberBlockLog.TAG, "open Ember refused: ${error.javaClass.simpleName}")
        }
    }
}