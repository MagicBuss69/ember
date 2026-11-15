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
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val open = Intent(this, MainActivity::class.java)
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getActivity(this, 0, open, piFlags)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Ember challenge open")
            .setContentText("10 minutes to confirm your reps.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
        val remaining = BlockerSnapshot.read(this).challengeDeadlineMs - System.currentTimeMillis()
        if (remaining > 0) {
            Handler(Looper.getMainLooper()).postDelayed(
                { stopSelf() },
                remaining.coerceAtMost(10L * 60L * 1000L + 5000L),
            )
        }
        return START_STICKY
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
        val channel = NotificationChannel(CHANNEL, "Challenge timer", NotificationManager.IMPORTANCE_LOW)
        mgr.createNotificationChannel(channel)
    }
}