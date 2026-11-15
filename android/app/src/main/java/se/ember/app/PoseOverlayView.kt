package se.ember.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

/** Left arm, right arm, and the line between the shoulders. Six joints: LS LE LW RS RE RW. */
class PoseOverlayView(context: Context, attrs: AttributeSet?) : View(context, attrs) {
    private var points = FloatArray(0)
    private val bone = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF7CFFB2.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 8f
        strokeCap = Paint.Cap.ROUND
    }
    private val joint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        style = Paint.Style.FILL
    }

    fun setSkeleton(normalized: FloatArray) {
        points = normalized
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f || points.size < 12) return
        val segments = intArrayOf(0, 1, 1, 2, 3, 4, 4, 5, 0, 3)
        var s = 0
        while (s + 1 < segments.size) {
            val a = segments[s]
            val b = segments[s + 1]
            val x1 = points[a * 2]
            val y1 = points[a * 2 + 1]
            val x2 = points[b * 2]
            val y2 = points[b * 2 + 1]
            if (!x1.isNaN() && !y1.isNaN() && !x2.isNaN() && !y2.isNaN()) {
                canvas.drawLine(x1 * w, y1 * h, x2 * w, y2 * h, bone)
            }
            s += 2
        }
        var j = 0
        while (j + 1 < points.size) {
            val x = points[j]
            val y = points[j + 1]
            if (!x.isNaN() && !y.isNaN()) canvas.drawCircle(x * w, y * h, 10f, joint)
            j += 2
        }
    }
}
