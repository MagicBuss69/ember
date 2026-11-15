package se.ember.app

import kotlin.math.acos
import kotlin.math.hypot

/**
 * Same thresholds as src/pushups.js.
 * Shoulder-line drop is the main signal. Elbow angle can confirm the same rep.
 */
object PushupCounter {
    const val DOWN_ANGLE = 110.0
    const val UP_ANGLE = 150.0
    const val MIN_LIKELIHOOD = 0.3f
    const val EMA = 0.7
    const val DROP_DOWN = 0.35
    const val DROP_UP = 0.12
    const val CALIBRATION_MS = 2000L
    const val REP_GAP_MS = 500L

    class State(
        var phase: String = "up",
        var reps: Int = 0,
        var angle: Double? = null,
        var height: Double? = null,
        var baseline: Double? = null,
        var calibrating: Boolean = true,
        var calibStartedAt: Long? = null,
        var lastRepAt: Long? = null,
        val calibSamples: MutableList<Double> = mutableListOf(),
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

    fun shoulderHeight(left: Arm?, right: Arm?): Double? {
        if (left == null || right == null) return null
        val width = span(left.shoulderX, left.shoulderY, right.shoulderX, right.shoulderY)
        if (width < 1e-3) return null
        val midY = (left.shoulderY + right.shoulderY) / 2.0
        val leftOk = left.likelihood >= MIN_LIKELIHOOD
        val rightOk = right.likelihood >= MIN_LIKELIHOOD
        val wristY = when {
            leftOk && rightOk && kotlin.math.abs(left.likelihood - right.likelihood) <= 0.2f ->
                (left.wristY + right.wristY) / 2.0
            leftOk && rightOk ->
                if (left.likelihood >= right.likelihood) left.wristY.toDouble() else right.wristY.toDouble()
            leftOk -> left.wristY.toDouble()
            rightOk -> right.wristY.toDouble()
            else -> return null
        }
        return (wristY - midY) / width
    }

    private fun ema(prev: Double?, sample: Double?): Double? {
        if (sample == null) return prev
        if (prev == null) return sample
        return EMA * sample + (1.0 - EMA) * prev
    }

    fun manualRep(state: State, nowMs: Long = System.currentTimeMillis()) {
        state.reps += 1
        state.phase = "up"
        state.calibrating = false
        state.lastRepAt = nowMs
    }

    fun observe(state: State, left: Arm?, right: Arm?, nowMs: Long) {
        val angle = combine(left, right)
        val height = shoulderHeight(left, right)
        if (angle == null && height == null) return
        state.angle = ema(state.angle, angle)
        state.height = ema(state.height, height)
        if (height != null && state.calibrating) {
            if (state.calibStartedAt == null) state.calibStartedAt = nowMs
            state.calibSamples.add(height)
            val started = state.calibStartedAt ?: nowMs
            if (nowMs - started >= CALIBRATION_MS && state.calibSamples.size >= 4) {
                val sorted = state.calibSamples.sorted()
                val mid = sorted.size / 2
                state.baseline = if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2.0
                state.calibrating = false
            } else {
                return
            }
        }
        val baseline = state.baseline
        val smoothedHeight = state.height
        val travel = if (baseline != null && smoothedHeight != null) baseline - smoothedHeight else null
        val shoulderDown = travel != null && travel >= DROP_DOWN
        val shoulderUp = travel != null && travel <= DROP_UP
        val smoothedAngle = state.angle
        val angleDown = smoothedAngle != null && smoothedAngle <= DOWN_ANGLE
        val angleUp = smoothedAngle != null && smoothedAngle >= UP_ANGLE
        val down = shoulderDown || angleDown
        val up = shoulderUp || angleUp
        if (state.phase == "up" && down) state.phase = "down"
        else if (state.phase == "down" && up && !down) {
            state.phase = "up"
            val last = state.lastRepAt
            if (last == null || nowMs - last >= REP_GAP_MS) {
                state.reps += 1
                state.lastRepAt = nowMs
            }
        }
    }

    private fun reading(arm: Arm?): Pair<Double, Float>? {
        if (arm == null || arm.likelihood < MIN_LIKELIHOOD) return null
        val angle = elbowAngle(arm.shoulderX, arm.shoulderY, arm.elbowX, arm.elbowY, arm.wristX, arm.wristY) ?: return null
        return angle to arm.likelihood
    }

    private fun combine(leftArm: Arm?, rightArm: Arm?): Double? {
        val left = reading(leftArm)
        val right = reading(rightArm)
        if (left == null && right == null) return null
        if (left != null && right != null && kotlin.math.abs(left.second - right.second) <= 0.2f) {
            return average(left.first, right.first)
        }
        val pick = when {
            left == null -> right
            right == null -> left
            left.second >= right.second -> left
            else -> right
        }
        return pick?.first
    }

    private fun average(a: Double?, b: Double?): Double? {
        if (a == null) return b
        if (b == null) return a
        return (a + b) / 2.0
    }
}
