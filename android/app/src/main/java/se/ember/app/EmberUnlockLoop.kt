package se.ember.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat

/** Relock when a push-up unlock ends, and warn about a minute before. */
object EmberUnlockLoop {
    const val WARN_MS = 60_000L
    const val WARN_NOTIF_ID = 7702
    private const val CHANNEL = "ember_unlock_soon"

    fun onExpired(context: Context) {
        val revoked = BlockerSnapshot.revokeExpired(context, System.currentTimeMillis())
        if (revoked.isEmpty()) return
        EmberAccessibilityService.kickIfWatching(revoked)
    }

    fun showWarning(context: Context, packageName: String) {
        val until = BlockerSnapshot.unlockUntil(context, packageName)
        val left = until - System.currentTimeMillis()
        if (left <= 0L || left > WARN_MS + 15_000L) return
        val snap = BlockerSnapshot.read(context)
        if (!snap.packages.contains(packageName)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "Unlock ending", NotificationManager.IMPORTANCE_HIGH)
            channel.description = "A minute before a blocked app locks again."
            manager.createNotificationChannel(channel)
        }
        val label = appLabel(context, packageName)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("$label locks again in about a minute")
            .setContentText(
                if (snap.blockMode == "quests") "Finish today's quests or redeem a reward to open it again."
                else "Another set of push-ups opens it again.",
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(70_000L)
            .build()
        try {
            manager.notify(WARN_NOTIF_ID, notification)
        } catch (_: Exception) {
            /* notification permission can be off */
        }
    }

    private fun appLabel(context: Context, packageName: String): String {
        return try {
            val pm = context.packageManager
            val info = pm.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            pm.getApplicationLabel(info)?.toString() ?: "This app"
        } catch (_: Exception) {
            "This app"
        }
    }
}
