package se.ember.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

typealias BlockerSnapshot = BlockerSnapshotData

data class BlockerSnapshotData(
    val locked: Boolean,
    val packages: List<String>,
    val challengeActive: Boolean,
    val challengeDeadlineMs: Long,
    val quiet: Boolean,
    val difficulty: Int,
    val nextRollAtMs: Long,
) {
    fun shouldBlock(packageName: String): Boolean {
        if (!locked) return false
        return packages.contains(packageName)
    }

    companion object {
        fun read(context: Context): BlockerSnapshotData {
            val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(EmberBlockerPlugin.KEY_SNAPSHOT, "{}") ?: "{}"
            return try {
                val json = JSONObject(raw)
                val packages = mutableListOf<String>()
                val arr = json.optJSONArray("packages") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val id = arr.optString(i, "")
                    if (id.isNotBlank()) packages.add(id)
                }
                val deadline = json.optString("challengeDeadline", "")
                val deadlineMs = if (deadline.isBlank()) 0L else parseIso(deadline)
                val roll = json.optString("nextRollAt", "")
                val rollMs = if (roll.isBlank()) 0L else parseIso(roll)
                BlockerSnapshotData(
                    locked = json.optBoolean("locked", true),
                    packages = packages,
                    challengeActive = json.optBoolean("challengeActive", false),
                    challengeDeadlineMs = deadlineMs,
                    quiet = json.optBoolean("quiet", false),
                    difficulty = json.optInt("difficulty", 1),
                    nextRollAtMs = rollMs,
                )
            } catch (_: Exception) {
                BlockerSnapshotData(true, emptyList(), false, 0L, false, 1, 0L)
            }
        }

        private fun parseIso(text: String): Long {
            return try {
                java.time.Instant.parse(text).toEpochMilli()
            } catch (_: Exception) {
                0L
            }
        }
    }
}