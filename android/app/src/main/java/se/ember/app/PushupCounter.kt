package se.ember.app

import kotlin.math.acos
import kotlin.math.hypot

/**
 * Same thresholds as src/pushups.js. A rep is a down-then-up of the elbow.
 */
object PushupCounter {
    const val DOWN_ANGLE = 95.0
    const val UP_ANGLE = 155.0
    const val MIN_LIKELIHOOD = 0.55f

    class State(var phase: String = "up", var reps: Int = 0)

    fun elbowAngle(sx: Float, sy: Float, ex: Float, ey: Float, wx: Float, wy: Float): Double? {
        val ax = sx - ex
        val ay = sy - ey
        val bx = wx - ex
        val by = wy - ey
        val mag = hypot(ax.toDouble(), ay.toDouble()) * hypot(bx.toDouble(), by.toDouble())
        if (mag < 1e-3) return null
        val cos = ((ax * bx + ay * by) / mag).coerceIn(-1.0, 1.0)
        return java.lang.Math.toDegrees(acos(cos))
    }

    fun step(state: State, angle: Double?) {
        if (angle == null) return
        if (state.phase == "up" && angle <= DOWN_ANGLE) state.phase = "down"
        else if (state.phase == "down" && angle >= UP_ANGLE) {
            state.phase = "up"
            state.reps += 1
        }
    }
}
