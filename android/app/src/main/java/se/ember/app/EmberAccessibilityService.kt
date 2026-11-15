package se.ember.app

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.NotificationCompat

class EmberAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val type = event.eventType
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            type != AccessibilityEvent.TYPE_WINDOWS_CHANGED
        ) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return
        val snap = BlockerSnapshot.read(this)
        val until = BlockerSnapshot.unlockUntil(this, pkg)
        if (!snap.shouldBlock(pkg, until)) return
        val now = System.currentTimeMillis()
        if (pkg == lastPackage && now - PushupActivity.lastLaunchMs < 350) return
        lastPackage = pkg
        PushupActivity.lastLaunchMs = now
        launchNow(pkg, snap.blockMode == "quests")
    }

    override fun onInterrupt() {}

    private fun launchNow(pkg: String, questsMode: Boolean) {
        val cls = if (questsMode) BlockActivity::class.java else PushupActivity::class.java
        val launch = Intent(this, cls).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
            putExtra(PushupActivity.EXTRA_PACKAGE, pkg)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val fullScreen = PendingIntent.getActivity(this, 7, launch, flags)
        ensureChannel()
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(if (questsMode) "Finish today's quests" else "Push-ups to open this app")
            .setContentText(if (questsMode) "This app stays locked until today's quests are done." else "Do the set, then the app opens.")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .setAutoCancel(true)
            .build()
        val manager = getSystemService(NotificationManager::class.java)
        try {
            manager.notify(NOTIF_ID, notification)
        } catch (_: Exception) {
            /* notification permission can be off; the activity start still runs */
        }
        try {
            startActivity(launch)
        } catch (_: Exception) {
            /* ColorOS may block this; the full-screen intent is the other path */
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL, "Open push-up challenge", NotificationManager.IMPORTANCE_HIGH)
        channel.setBypassDnd(true)
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL = "ember_pushup_launch"
        private const val NOTIF_ID = 7701
        @Volatile private var lastPackage: String = ""
    }
}
