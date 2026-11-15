package se.ember.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

object EmberAlarmScheduler {
    const val ACTION_ROLL = "se.ember.app.ALARM_ROLL"
    const val ACTION_DEADLINE = "se.ember.app.ALARM_DEADLINE"
    const val ACTION_UNLOCK_EXPIRE = "se.ember.app.UNLOCK_EXPIRE"
    const val ACTION_UNLOCK_WARN = "se.ember.app.UNLOCK_WARN"
    const val EXTRA_PACKAGE = "package"
    private const val REQ_ROLL = 4401
    private const val REQ_DEADLINE = 4402
    private const val REQ_UNLOCK_EXPIRE = 4411
    private const val REQ_UNLOCK_WARN = 4412

    fun reschedule(context: Context) {
        val snap = BlockerSnapshot.read(context)
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancel(context, am, REQ_ROLL, ACTION_ROLL)
        cancel(context, am, REQ_DEADLINE, ACTION_DEADLINE)
        cancel(context, am, REQ_UNLOCK_EXPIRE, ACTION_UNLOCK_EXPIRE)
        cancel(context, am, REQ_UNLOCK_WARN, ACTION_UNLOCK_WARN)
        val now = System.currentTimeMillis()
        scheduleNextUnlock(context, am, snap, now)
        if (snap.quiet) return
        if (snap.nextRollAtMs > now) {
            scheduleExact(context, am, REQ_ROLL, ACTION_ROLL, snap.nextRollAtMs)
        }
        if (snap.challengeActive && snap.challengeDeadlineMs > now) {
            scheduleExact(context, am, REQ_DEADLINE, ACTION_DEADLINE, snap.challengeDeadlineMs)
            EmberChallengeForegroundService.start(context)
        } else {
            EmberChallengeForegroundService.stop(context)
        }
    }

    /** The soonest push-up unlock is an exact alarm, with a heads-up one minute before. */
    private fun scheduleNextUnlock(context: Context, am: AlarmManager, snap: BlockerSnapshotData, now: Long) {
        if (snap.blockMode != "pushups") return
        var nextAt = 0L
        var nextPkg = ""
        for ((pkg, until) in BlockerSnapshot.readUnlocks(context)) {
            if (!snap.packages.contains(pkg) || until <= now) continue
            if (nextAt == 0L || until < nextAt || (until == nextAt && pkg < nextPkg)) {
                nextAt = until
                nextPkg = pkg
            }
        }
        if (nextPkg.isBlank()) return
        scheduleExact(context, am, REQ_UNLOCK_EXPIRE, ACTION_UNLOCK_EXPIRE, nextAt, nextPkg)
        val warnAt = nextAt - EmberUnlockLoop.WARN_MS
        if (warnAt > now) {
            scheduleExact(context, am, REQ_UNLOCK_WARN, ACTION_UNLOCK_WARN, warnAt, nextPkg)
        }
    }

    private fun scheduleExact(
        context: Context,
        am: AlarmManager,
        req: Int,
        action: String,
        atMs: Long,
        packageName: String = "",
    ) {
        val intent = Intent(context, EmberAlarmReceiver::class.java).setAction(action)
        if (packageName.isNotBlank()) intent.putExtra(EXTRA_PACKAGE, packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val pi = PendingIntent.getBroadcast(context, req, intent, flags)
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms() ->
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi)
            else ->
                am.setExact(AlarmManager.RTC_WAKEUP, atMs, pi)
        }
    }

    private fun cancel(context: Context, am: AlarmManager, req: Int, action: String) {
        val intent = Intent(context, EmberAlarmReceiver::class.java).setAction(action)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pi = PendingIntent.getBroadcast(context, req, intent, flags or PendingIntent.FLAG_NO_CREATE)
        if (pi != null) am.cancel(pi)
    }
}