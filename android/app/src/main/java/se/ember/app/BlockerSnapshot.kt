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
    val snapshotDay: String = "",
    val challengePenalty: Boolean = false,
) {
    fun shouldBlock(packageName: String, unlockedUntilMs: Long = 0L, now: Long = System.currentTimeMillis()): Boolean {
        if (packageName.isBlank() || packageName == "se.ember.app") return false
        if (!packages.contains(packageName)) return false
        // A failed hourly challenge keeps apps locked until the next one is finished.
        if (challengePenalty) return true
        // A running unlock (push-ups or a redeemed reward) opens the app in both modes.
        if (now < unlockedUntilMs) return false
        if (blockMode == "quests") {
            // The snapshot was written on a previous civil day. Quests for the new day
            // are not done yet, so stay locked until Ember refreshes it.
            if (snapshotDay.isNotBlank() && snapshotDay != civilDay(now)) return true
            return locked
        }
        return true
    }

    private fun civilDay(now: Long): String {
        val cal = java.util.Calendar.getInstance()
        cal.timeInMillis = now
        val year = cal.get(java.util.Calendar.YEAR)
        val month = cal.get(java.util.Calendar.MONTH) + 1
        val day = cal.get(java.util.Calendar.DAY_OF_MONTH)
        return "%04d-%02d-%02d".format(year, month, day)
    }

    companion object {
        fun read(context: Context): BlockerSnapshotData {
            val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(EmberBlockerPlugin.KEY_SNAPSHOT, "{}") ?: "{}"
            return try {
                val json = JSONObject(raw)
                val packages = mutableListOf<String>()
                val seen = HashSet<String>()
                val arr = json.optJSONArray("packages") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val id = arr.optString(i, "")
                    if (id.isNotBlank() && id != "se.ember.app" && seen.add(id)) packages.add(id)
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
                    snapshotDay = json.optString("today", ""),
                    challengePenalty = json.optBoolean("challengePenalty", false),
                )
            } catch (_: Exception) {
                BlockerSnapshotData(true, emptyList(), false, 0L, false, 1, 0L, "pushups", 15, 10, "", 0, false)
            }
        }

        private val LOCK = Any()

        fun unlockUntil(context: Context, packageName: String): Long {
            val all = readUnlocks(context)
            return all[packageName] ?: 0L
        }

        fun readUnlocks(context: Context): Map<String, Long> {
            synchronized(LOCK) {
                val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
                val raw = prefs.getString(EmberBlockerPlugin.KEY_UNLOCKS, "{}") ?: "{}"
                val json = try {
                    JSONObject(raw)
                } catch (_: Exception) {
                    return emptyMap()
                }
                val out = LinkedHashMap<String, Long>()
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (key.isBlank()) continue
                    val until = json.optLong(key, 0L)
                    if (until > 0L) out[key] = until
                }
                return out
            }
        }

        fun grantUnlock(context: Context, packageName: String, untilMs: Long) {
            if (read(context).challengePenalty) return
            synchronized(LOCK) {
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
            EmberAlarmScheduler.reschedule(context)
        }

        /**
         * Opens every package for `durationMs`, extending each app's running window.
         * Returns the latest end time written.
         */
        fun grantRewardUnlock(context: Context, packages: List<String>, durationMs: Long, now: Long): Long {
            if (read(context).challengePenalty) return now
            var latest = now + durationMs
            synchronized(LOCK) {
                val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
                val raw = prefs.getString(EmberBlockerPlugin.KEY_UNLOCKS, "{}") ?: "{}"
                val json = try {
                    JSONObject(raw)
                } catch (_: Exception) {
                    JSONObject()
                }
                val keep = JSONObject()
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val until = json.optLong(key, 0L)
                    if (key.isNotBlank() && until > now) keep.put(key, until)
                }
                for (pkg in packages) {
                    if (pkg.isBlank()) continue
                    val current = keep.optLong(pkg, 0L)
                    val base = if (current > now) current else now
                    val until = base + durationMs
                    keep.put(pkg, until)
                    if (until > latest) latest = until
                }
                prefs.edit().putString(EmberBlockerPlugin.KEY_UNLOCKS, keep.toString()).commit()
            }
            EmberAlarmScheduler.reschedule(context)
            return latest
        }

        /** Drops every unlock. Used when a failed challenge locks apps again. */
        fun revokeAllUnlocks(context: Context) {
            synchronized(LOCK) {
                val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
                prefs.edit().putString(EmberBlockerPlugin.KEY_UNLOCKS, "{}").commit()
            }
        }

        /** Drops windows that have ended so the app is blocked again. */
        fun revokeExpired(context: Context, now: Long): List<String> {
            synchronized(LOCK) {
                val prefs = context.getSharedPreferences(EmberBlockerPlugin.PREFS, Context.MODE_PRIVATE)
                val raw = prefs.getString(EmberBlockerPlugin.KEY_UNLOCKS, "{}") ?: "{}"
                val json = try {
                    JSONObject(raw)
                } catch (_: Exception) {
                    return emptyList()
                }
                val keys = json.keys()
                val keep = JSONObject()
                val revoked = mutableListOf<String>()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val until = json.optLong(key, 0L)
                    if (key.isNotBlank() && until > now) keep.put(key, until)
                    else if (key.isNotBlank()) revoked.add(key)
                }
                if (revoked.isNotEmpty()) {
                    prefs.edit().putString(EmberBlockerPlugin.KEY_UNLOCKS, keep.toString()).commit()
                }
                return revoked
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
