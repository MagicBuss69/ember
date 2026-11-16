package se.ember.app

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.NotificationCompat

class EmberAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private var foregroundPackage: String = ""
    private var watchPackage: String = ""
    private var watchUntil: Long = 0L
    private var warnedUntil: Long = 0L
    private val expireRunnable = Runnable { onWatchFired() }
    private val warnRunnable = Runnable { onWarnFired() }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        handler.post { refreshForeground() }
        handler.postDelayed({ refreshForeground() }, 400)
        handler.postDelayed({ refreshForeground() }, 1200)
    }

    override fun onUnbind(intent: Intent): Boolean {
        if (instance == this) instance = null
        clearWatch()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance == this) instance = null
        clearWatch()
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        foregroundPackage = pkg
        evaluate(pkg)
    }

    override fun onInterrupt() {}

    private fun refreshForeground() {
        val pkg = try {
            rootInActiveWindow?.packageName?.toString()
        } catch (_: Exception) {
            null
        }
        if (pkg.isNullOrBlank()) return
        foregroundPackage = pkg
        evaluate(pkg)
    }

    private fun evaluate(pkg: String) {
        if (EmberGate.isIgnoredPackage(pkg, packageName)) {
            clearWatch()
            return
        }
        val snap = BlockerSnapshot.read(this)
        val until = BlockerSnapshot.unlockUntil(this, pkg)
        val now = System.currentTimeMillis()
        if (snap.blockMode != "quests" && snap.packages.contains(pkg) && until > now) {
            armWatch(pkg, until, now)
        } else if (pkg == watchPackage) {
            clearWatch()
        }
        if (!EmberGate.allowInterception()) {
            if (snap.shouldBlock(pkg, until, now)) {
                android.util.Log.i(EmberBlockLog.TAG, "skip gate for $pkg; Ember is open or just opened")
            }
            return
        }
        if (!snap.shouldBlock(pkg, until, now)) return
        if (!confirmedBlocked(pkg)) return
        launchGate(pkg, snap.blockMode == "quests", now)
    }

    /** A stale window event must not gate Ember, the launcher, or the keyguard. */
    private fun confirmedBlocked(expected: String): Boolean {
        if (EmberGate.isIgnoredPackage(expected, packageName)) return false
        if (EmberGate.mainStarted) return false
        val live = liveForeground()
        if (live.isBlank()) return true
        if (EmberGate.isIgnoredPackage(live, packageName)) return false
        return live == expected
    }

    /** While a blocked app is open, fire at its unlock expiry even with no new window event. */
    private fun armWatch(pkg: String, until: Long, now: Long) {
        if (pkg == watchPackage && until == watchUntil) return
        clearWatch()
        watchPackage = pkg
        watchUntil = until
        handler.postDelayed(expireRunnable, (until - now).coerceAtLeast(0L))
        val warnIn = until - EmberUnlockLoop.WARN_MS - now
        if (warnIn > 0L) {
            handler.postDelayed(warnRunnable, warnIn)
        } else if (until - now > 5_000L && warnedUntil != until) {
            warnedUntil = until
            EmberUnlockLoop.showWarning(this, pkg)
        }
    }

    private fun clearWatch() {
        handler.removeCallbacks(expireRunnable)
        handler.removeCallbacks(warnRunnable)
        watchPackage = ""
        watchUntil = 0L
    }

    private fun onWatchFired() {
        val pkg = watchPackage
        watchPackage = ""
        watchUntil = 0L
        if (pkg.isBlank()) return
        val now = System.currentTimeMillis()
        val until = BlockerSnapshot.unlockUntil(this, pkg)
        if (until > now) {
            armWatch(pkg, until, now)
            return
        }
        BlockerSnapshot.revokeExpired(this, now)
        EmberAlarmScheduler.reschedule(this)
        kickIfForeground(listOf(pkg))
    }

    private fun onWarnFired() {
        val pkg = watchPackage
        val until = watchUntil
        if (pkg.isBlank() || warnedUntil == until) return
        warnedUntil = until
        EmberUnlockLoop.showWarning(this, pkg)
    }

    private fun kickIfForeground(packages: List<String>) {
        if (EmberGate.mainStarted) return
        val live = liveForeground()
        if (live.isNotBlank()) foregroundPackage = live
        val fg = foregroundPackage
        if (fg.isBlank() || EmberGate.isIgnoredPackage(fg, packageName)) return
        if (live.isNotBlank() && live != fg) return
        if (!packages.contains(fg)) return
        val snap = BlockerSnapshot.read(this)
        val now = System.currentTimeMillis()
        if (!snap.shouldBlock(fg, 0L, now)) return
        launchGate(fg, snap.blockMode == "quests", now)
    }

    private fun liveForeground(): String {
        return try {
            rootInActiveWindow?.packageName?.toString().orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun launchGate(pkg: String, questsMode: Boolean, now: Long) {
        if (pkg == lastPackage && now - PushupActivity.lastLaunchMs < 350) return
        lastPackage = pkg
        PushupActivity.lastLaunchMs = now
        launchNow(pkg, questsMode)
    }

    private fun launchNow(pkg: String, questsMode: Boolean) {
        if (EmberGate.mainStarted || !confirmedBlocked(pkg)) {
            android.util.Log.i(EmberBlockLog.TAG, "skip gate for $pkg; Ember or system UI is in front")
            return
        }
        android.util.Log.i(EmberBlockLog.TAG, "launch gate for $pkg quests=$questsMode")
        val cls = if (questsMode) BlockActivity::class.java else PushupActivity::class.java
        val launch = Intent(this, cls).apply {
            addFlags(EmberGate.gateFlags())
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
        } catch (error: Exception) {
            android.util.Log.i(
                EmberBlockLog.TAG,
                "skip home; startActivity failed (${error.javaClass.simpleName}) for $pkg",
            )
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
        private const val NOTIF_ID = EmberGate.PUSHUP_NOTIF_ID
        @Volatile private var lastPackage: String = ""
        @Volatile private var instance: EmberAccessibilityService? = null

        /** Alarm expiry: if that app is still in front, cover it with the gate. */
        @JvmStatic
        fun kickIfWatching(packages: List<String>) {
            val svc = instance ?: return
            svc.handler.post { svc.kickIfForeground(packages) }
        }

        @JvmStatic
        fun livePackage(): String {
            val svc = instance ?: return ""
            return svc.liveForeground().ifBlank { svc.foregroundPackage }
        }
    }
}
