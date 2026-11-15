package se.ember.app

import android.app.NotificationManager
import android.content.Context

/** Distinguishes a normal launcher open from a blocked-app interception. */
object EmberGate {
    const val PUSHUP_NOTIF_ID = 7701
    private const val GRACE_MS = 1800L

    @Volatile
    var userLaunchAt: Long = 0L

    @JvmStatic
    fun noteLauncherOpen(context: Context) {
        userLaunchAt = System.currentTimeMillis()
        val manager = context.getSystemService(NotificationManager::class.java)
        manager?.cancel(PUSHUP_NOTIF_ID)
    }

    /** False for a short time after the user opens Ember from the launcher. */
    @JvmStatic
    fun allowInterception(): Boolean {
        return System.currentTimeMillis() - userLaunchAt > GRACE_MS
    }

    @JvmStatic
    fun isIgnoredPackage(packageName: String, self: String): Boolean {
        if (packageName == self) return true
        return packageName == "android" ||
            packageName == "com.android.systemui" ||
            packageName == "com.android.settings" ||
            packageName.endsWith(".launcher") ||
            packageName.contains("launcher")
    }
}
