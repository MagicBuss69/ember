package se.ember.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object EmberInbox {
    private const val PREFS = "ember_inbox"
    private const val KEY = "events"

    fun append(context: Context, type: String, challengeId: String = "") {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = try {
            JSONArray(prefs.getString(KEY, "[]") ?: "[]")
        } catch (_: Exception) {
            JSONArray()
        }
        val row = JSONObject()
        row.put("type", type)
        if (challengeId.isNotBlank()) row.put("challengeId", challengeId)
        arr.put(row)
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun drain(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, "[]") ?: "[]"
        prefs.edit().remove(KEY).apply()
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }
}