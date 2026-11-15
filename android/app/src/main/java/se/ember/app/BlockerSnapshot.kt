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
    val blockMode: String,
    val unlockMinutes: Int,
    val pushupMax: Int,
    val challengeLabel: String,
    val challengeReps: Int,
    val challengeIsSeconds: Boolean,
) {
    fun shouldBlock(packageName: String, unlockedUntilMs: Long = 0L, now: Long = System.currentTimeMillis()): Boolean {
        if (!packages.contains(packageName)) return false
        if (blockMode == "quests") return locked
        return now >= unlockedUntilMs
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
                val mode = json.optString("blockMode", "pushups")
                BlockerSnapshotData(
                    locked = json.optBoolean("locked", true),
                    packages = packages,
                    challengeActive = json.optBoolean("challengeActive", false),
                    challengeDeadlineMs = deadlineMs,
                    quiet = json.optBoolean("quiet", false),
                    difficulty = json.optInt("difficulty", 1),
                    nextRollAtMs = rollMs,
                    blockMode = if (mode == "quests") "quests" else "pushups",
                    unlockMinutes = json.optInt("unlockMinutes", 15).coerceIn(1, 180),
                    pushupMax = json.optInt("pushupMax", 10).coerceIn(1, 300),
                    challengeLabel = json.optString("challengeLabel", ""),
                    challengeReps = json.optInt("challengeReps", 0),
                    challengeIsSeconds = json.optBoolean("challengeIsSeconds", false),
                )
            } catch (_: Exception) {
                BlockerSnapshotData(true, emptyList(), false, 0L, false, 1, 0L, "pushups", 15, 10, "", 0, false)
            }
        }

        fun unlockUntil(context: Context, packageName: String): Long {
            val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(EmberBlockerPlugin.KEY_UNLOCKS, "{}") ?: "{}"
            return try {
                JSONObject(raw).optLong(packageName, 0L)
            } catch (_: Exception) {
                0L
            }
        }

        fun grantUnlock(context: Context, packageName: String, untilMs: Long) {
            val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(EmberBlockerPlugin.KEY_UNLOCKS, "{}") ?: "{}"
            val json = try {
                JSONObject(raw)
            } catch (_: Exception) {
                JSONObject()
            }
            val now = System.currentTimeMillis()
            val keys = json.keys()
            val keep = JSONObject()
            while (keys.hasNext()) {
                val key = keys.next()
                val until = json.optLong(key, 0L)
                if (until > now) keep.put(key, until)
            }
            keep.put(packageName, untilMs)
            prefs.edit().putString(EmberBlockerPlugin.KEY_UNLOCKS, keep.toString()).commit()
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
