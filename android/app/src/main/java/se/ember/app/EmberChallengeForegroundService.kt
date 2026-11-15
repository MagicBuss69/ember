package se.ember.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

class EmberChallengeForegroundService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            refresh(fromStart = false)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        handler.removeCallbacks(tick)
        return refresh(fromStart = true)
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    private fun refresh(fromStart: Boolean): Int {
        val snap = BlockerSnapshot.read(this)
        val left = snap.challengeDeadlineMs - System.currentTimeMillis()
        val live = snap.challengeActive && !snap.quiet && left > 0
        val notification = buildNotification(snap, left)
        if (fromStart) startInForeground(notification)
        if (!live) {
            if (!fromStart) {
                val mgr = getSystemService(NotificationManager::class.java)
                mgr.cancel(NOTIF_ID)
            }
            stopSelf()
            return START_NOT_STICKY
        }
        if (!fromStart) {
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.notify(NOTIF_ID, notification)
        }
        handler.postDelayed(tick, 1000)
        return START_STICKY
    }

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(snap: BlockerSnapshotData, leftMs: Long): Notification {
        val label = snap.challengeLabel.ifBlank { "Move" }
        val count = if (snap.challengeReps > 0) snap.challengeReps else 0
        val unit = if (snap.challengeIsSeconds) "seconds" else "reps"
        val left = formatLeft(leftMs)
        val line = if (count > 0) "$count $unit · $left left" else "$left left"
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(label)
            .setContentText(line)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$label\n$line\nTap Done when you finish."))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openIntent(confirm = false))
            .addAction(0, "Done", openIntent(confirm = true))
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun openIntent(confirm: Boolean): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("ember_open_challenge", true)
            .putExtra("ember_confirm_challenge", confirm)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(this, if (confirm) 2 else 1, intent, flags)
    }

    private fun formatLeft(ms: Long): String {
        val total = ((ms.coerceAtLeast(0) + 999) / 1000)
        val minutes = total / 60
        val seconds = total % 60
        return "%d:%02d".format(minutes, seconds)
    }

    companion object {
        private const val CHANNEL = "ember_challenge"
        private const val NOTIF_ID = 4420

        fun start(context: Context) {
            val intent = Intent(context, EmberChallengeForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, EmberChallengeForegroundService::class.java))
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL, "Challenge timer", NotificationManager.IMPORTANCE_DEFAULT)
        mgr.createNotificationChannel(channel)
    }
}
