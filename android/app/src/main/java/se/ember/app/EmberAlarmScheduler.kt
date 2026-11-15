package se.ember.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

object EmberAlarmScheduler {
    const val ACTION_ROLL = "se.ember.app.ALARM_ROLL"
    const val ACTION_DEADLINE = "se.ember.app.ALARM_DEADLINE"
    private const val REQ_ROLL = 4401
    private const val REQ_DEADLINE = 4402

    fun reschedule(context: Context) {
        val snap = BlockerSnapshot.read(context)
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancel(context, am, REQ_ROLL, ACTION_ROLL)
        cancel(context, am, REQ_DEADLINE, ACTION_DEADLINE)
        val now = System.currentTimeMillis()
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

    private fun scheduleExact(context: Context, am: AlarmManager, req: Int, action: String, atMs: Long) {
        val intent = Intent(context, EmberAlarmReceiver::class.java).setAction(action)
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