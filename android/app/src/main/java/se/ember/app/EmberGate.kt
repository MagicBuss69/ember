package se.ember.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent

/** Keeps a normal Ember open from being treated as a blocked-app interception. */
object EmberGate {
    const val PUSHUP_NOTIF_ID = 7701
    private const val GRACE_MS = 1800L

    @Volatile
    var userLaunchAt: Long = 0L

    /** True while the main Ember activity is resumed. */
    @JvmStatic
    @Volatile
    var mainStarted: Boolean = false

    /** Ember is coming to the front by any route: launcher, unlock, recents, notification. */
    @JvmStatic
    fun noteEmberFront() {
        userLaunchAt = System.currentTimeMillis()
    }

    /** Ember left the front. The open grace ends so a blocked app is gated right away. */
    @JvmStatic
    fun noteEmberAway() {
        userLaunchAt = 0L
    }

    @JvmStatic
    fun noteLauncherOpen(context: Context) {
        userLaunchAt = System.currentTimeMillis()
        val manager = context.getSystemService(NotificationManager::class.java)
        manager?.cancel(PUSHUP_NOTIF_ID)
    }

    /** False while Ember itself is in front, and for a short time after it opens. */
    @JvmStatic
    fun allowInterception(): Boolean {
        if (mainStarted) return false
        return System.currentTimeMillis() - userLaunchAt > GRACE_MS
    }

    /**
     * Ember, the launcher, the status bar, and the keyguard are never a blocked app.
     * Home and finish must not run for these.
     */
    @JvmStatic
    fun isIgnoredPackage(packageName: String, self: String): Boolean {
        if (packageName.isBlank() || packageName == self) return true
        return isSystemChrome(packageName)
    }

    /** Launcher, status bar, and keyguard. Ember's own package is not chrome. */
    @JvmStatic
    fun isSystemChrome(packageName: String): Boolean {
        if (packageName.isBlank()) return false
        val name = packageName.lowercase()
        return name == "android" ||
            name.contains("systemui") ||
            name.contains("keyguard") ||
            name.contains("launcher") ||
            name == "com.android.settings"
    }

    /** Gate flags. NEW_TASK plus a separate taskAffinity keeps this out of Ember's task. */
    @JvmStatic
    fun gateFlags(): Int {
        return Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
}
