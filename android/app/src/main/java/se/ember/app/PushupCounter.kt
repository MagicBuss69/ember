package se.ember.app

import kotlin.math.acos
import kotlin.math.hypot

/**
 * Same thresholds as src/pushups.js.
 * Down at or below 110°, up at or above 150°, with a wrist-to-shoulder fold backup.
 */
object PushupCounter {
    const val DOWN_ANGLE = 110.0
    const val UP_ANGLE = 150.0
    const val MIN_LIKELIHOOD = 0.3f
    const val EMA = 0.7
    const val FOLD_DOWN = 0.28
    const val FOLD_UP = 0.12

    class State(
        var phase: String = "up",
        var reps: Int = 0,
        var angle: Double? = null,
        var fold: Double? = null,
    )

    class Arm(
        val shoulderX: Float,
        val shoulderY: Float,
        val elbowX: Float,
        val elbowY: Float,
        val wristX: Float,
        val wristY: Float,
        val likelihood: Float,
    )

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

    private fun span(ax: Float, ay: Float, bx: Float, by: Float): Double {
        return hypot((ax - bx).toDouble(), (ay - by).toDouble())
    }

    fun armFold(sx: Float, sy: Float, ex: Float, ey: Float, wx: Float, wy: Float): Double? {
        val segments = span(sx, sy, ex, ey) + span(ex, ey, wx, wy)
        if (segments < 1e-3) return null
        val reach = span(sx, sy, wx, wy)
        return (1.0 - reach / segments).coerceIn(0.0, 1.0)
    }

    private fun ema(prev: Double?, sample: Double?): Double? {
        if (sample == null) return prev
        if (prev == null) return sample
        return EMA * sample + (1.0 - EMA) * prev
    }

    fun manualRep(state: State) {
        state.reps += 1
        state.phase = "up"
    }

    fun observe(state: State, left: Arm?, right: Arm?) {
        val sample = combine(left, right)
        val angle = sample.first
        val fold = sample.second
        if (angle == null && fold == null) return
        state.angle = ema(state.angle, angle)
        state.fold = ema(state.fold, fold)
        val smoothedAngle = state.angle
        val smoothedFold = state.fold
        val angleDown = smoothedAngle != null && smoothedAngle <= DOWN_ANGLE
        val angleUp = smoothedAngle != null && smoothedAngle >= UP_ANGLE
        val foldDown = smoothedFold != null && smoothedFold >= FOLD_DOWN
        val foldUp = smoothedFold != null && smoothedFold <= FOLD_UP
        val down = angleDown || (smoothedAngle == null && foldDown) || (smoothedAngle != null && smoothedAngle <= 130.0 && foldDown)
        val up = angleUp || (smoothedAngle == null && foldUp)
        if (state.phase == "up" && down && !up) state.phase = "down"
        else if (state.phase == "down" && up && !down) {
            state.phase = "up"
            state.reps += 1
        }
    }

    private fun reading(arm: Arm?): Triple<Double?, Double?, Float>? {
        if (arm == null || arm.likelihood < MIN_LIKELIHOOD) return null
        val angle = elbowAngle(arm.shoulderX, arm.shoulderY, arm.elbowX, arm.elbowY, arm.wristX, arm.wristY)
        val fold = armFold(arm.shoulderX, arm.shoulderY, arm.elbowX, arm.elbowY, arm.wristX, arm.wristY)
        if (angle == null && fold == null) return null
        return Triple(angle, fold, arm.likelihood)
    }

    private fun combine(leftArm: Arm?, rightArm: Arm?): Pair<Double?, Double?> {
        val left = reading(leftArm)
        val right = reading(rightArm)
        if (left == null && right == null) return null to null
        if (left != null && right != null && kotlin.math.abs(left.third - right.third) <= 0.2f) {
            return average(left.first, right.first) to average(left.second, right.second)
        }
        val pick = when {
            left == null -> right
            right == null -> left
            left.third >= right.third -> left
            else -> right
        }
        return pick!!.first to pick.second
    }

    private fun average(a: Double?, b: Double?): Double? {
        if (a == null) return b
        if (b == null) return a
        return (a + b) / 2.0
    }
}
