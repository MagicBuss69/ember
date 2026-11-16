package se.ember.app

import android.app.Application
import android.util.Log

/** Logs any crash to the EmberBlock tag so a first-open exit shows up in logcat. */
class EmberApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                Log.e(EmberBlockLog.TAG, "crash on ${thread.name}: ${error.javaClass.name}: ${error.message}", error)
            } catch (_: Throwable) {
                /* logging must never hide the crash */
            }
            if (previous != null) previous.uncaughtException(thread, error)
        }
        Log.i(EmberBlockLog.TAG, "process start")
    }
}
