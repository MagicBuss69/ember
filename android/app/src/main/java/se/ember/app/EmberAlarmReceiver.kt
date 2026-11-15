package se.ember.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class EmberAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
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
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        context.startActivity(main)
    }
}