package se.ember.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

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
                showRollNotification(context)
            }
            EmberAlarmScheduler.ACTION_DEADLINE -> {
                val snap = BlockerSnapshot.read(context)
                val id = readChallengeId(context)
                val expired = snap.challengeActive && snap.challengeDeadlineMs > 0L &&
                    snap.challengeDeadlineMs <= System.currentTimeMillis()
                if (expired && id.isNotBlank()) {
                    EmberInbox.append(context, "miss", id)
                    showMissNotification(context, snap)
                }
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

    private fun showRollNotification(context: Context) {
        ensureRollChannel(context)
        val snap = BlockerSnapshot.read(context)
        val title = "Time to move"
        val line = if (snap.challengeLabel.isNotBlank()) "New challenge: ${snap.challengeLabel}" else "Open Ember for your hourly challenge."
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        val notification = NotificationCompat.Builder(context, ROLL_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(line)
            .setStyle(NotificationCompat.BigTextStyle().bigText(line))
            .setContentIntent(openChallengeIntent(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        try {
            mgr.notify(ROLL_NOTIF_ID, notification)
        } catch (_: Exception) {
            /* POST_NOTIFICATIONS not granted */
        }
    }

    private fun showMissNotification(context: Context, snap: BlockerSnapshotData) {
        ensureRollChannel(context)
        val label = snap.challengeLabel.ifBlank { "Challenge" }
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        val notification = NotificationCompat.Builder(context, ROLL_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("$label time's up")
            .setContentText("Open Ember to see your result.")
            .setContentIntent(openChallengeIntent(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            mgr.notify(MISS_NOTIF_ID, notification)
        } catch (_: Exception) {
            /* POST_NOTIFICATIONS not granted */
        }
    }

    private fun openChallengeIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("ember_open_challenge", true)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(context, REQ_OPEN_CHALLENGE, intent, flags)
    }

    private fun ensureRollChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(ROLL_CHANNEL, "Hourly challenges", NotificationManager.IMPORTANCE_HIGH)
        channel.description = "When it's time for a movement challenge."
        mgr.createNotificationChannel(channel)
    }

    companion object {
        private const val ROLL_CHANNEL = "ember_hourly_roll"
        private const val ROLL_NOTIF_ID = 4431
        private const val MISS_NOTIF_ID = 4432
        private const val REQ_OPEN_CHALLENGE = 4433
    }
}