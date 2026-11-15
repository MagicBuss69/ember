package se.ember.app

import android.util.Log

/** Logcat tag for anything that finishes an activity, goes home, or moves the task back. */
object EmberBlockLog {
    const val TAG = "EmberBlock"

    @JvmStatic
    fun finish(where: String, reason: String) {
        Log.i(TAG, "finish $where: $reason")
    }

    @JvmStatic
    fun home(where: String, reason: String) {
        Log.i(TAG, "home $where: $reason")
    }

    @JvmStatic
    fun moveToBack(where: String, reason: String) {
        Log.i(TAG, "moveTaskToBack $where: $reason")
    }
}
