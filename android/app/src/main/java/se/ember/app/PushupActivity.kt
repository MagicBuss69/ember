package se.ember.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.accurate.AccuratePoseDetectorOptions
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class PushupActivity : AppCompatActivity() {
    private val counter = PushupCounter.State()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val poseFailed = AtomicBoolean(false)
    private var practice = false
    private var manual = false
    private var target = 10
    private var blockedPackage = ""
    private var finished = false
    private var sawPose = false

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else useManual("Camera permission is off, so Ember can't see the reps.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pushup)
        practice = intent.getBooleanExtra(EXTRA_PRACTICE, false)
        blockedPackage = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val snap = BlockerSnapshot.read(this)
        target = snap.pushupMax
        findViewById<TextView>(R.id.pushup_target).text = if (practice) {
            "Test set. Do as many as you can. Beating $target raises your max."
        } else {
            "Target $target. The app stays open for ${snap.unlockMinutes} minutes after that."
        }
        findViewById<Button>(R.id.pushup_cancel).setOnClickListener { cancel() }
        findViewById<Button>(R.id.pushup_add).setOnClickListener { addManualRep() }
        findViewById<Button>(R.id.pushup_done).setOnClickListener { finishPractice() }
        findViewById<Button>(R.id.pushup_manual).setOnClickListener {
            useManual("You're counting the reps yourself.")
        }
        if (practice) findViewById<Button>(R.id.pushup_done).visibility = View.VISIBLE
        render()
        when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> startCamera()
            else -> cameraPermission.launch(Manifest.permission.CAMERA)
        }
        mainHandler.postDelayed({
            if (!sawPose && !manual && !finished) {
                findViewById<Button>(R.id.pushup_manual).visibility = View.VISIBLE
                findViewById<TextView>(R.id.pushup_note).apply {
                    visibility = View.VISIBLE
                    text = "No pose yet. Stay in frame, or count the reps yourself."
                }
            }
        }, 8000)
    }

    override fun onStart() {
        super.onStart()
        showing = true
    }

    override fun onStop() {
        showing = false
        super.onStop()
    }

    override fun onDestroy() {
        analysisExecutor.shutdown()
        super.onDestroy()
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(findViewById<PreviewView>(R.id.pushup_preview).surfaceProvider)
                }
                val options = AccuratePoseDetectorOptions.Builder()
                    .setDetectorMode(AccuratePoseDetectorOptions.STREAM_MODE)
                    .build()
                val detector = PoseDetection.getClient(options)
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                    val media = imageProxy.image
                    if (media == null || manual || finished) {
                        imageProxy.close()
                        return@setAnalyzer
                    }
                    val image = InputImage.fromMediaImage(media, imageProxy.imageInfo.rotationDegrees)
                    detector.process(image)
                        .addOnSuccessListener { pose -> onPose(pose) }
                        .addOnFailureListener {
                            if (poseFailed.compareAndSet(false, true)) {
                                mainHandler.post { useManual("Pose detection failed, so Ember can't count from the camera.") }
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis)
            } catch (_: Exception) {
                useManual("The camera didn't start, so Ember can't count from it.")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun onPose(pose: Pose) {
        val angle = visibleElbow(pose) ?: return
        sawPose = true
        PushupCounter.step(counter, angle)
        mainHandler.post {
            if (finished) return@post
            render()
            if (!practice && counter.reps >= target) completeChallenge()
        }
    }

    private fun visibleElbow(pose: Pose): Double? {
        val left = landmarkAngle(pose, PoseLandmark.LEFT_SHOULDER, PoseLandmark.LEFT_ELBOW, PoseLandmark.LEFT_WRIST)
        val right = landmarkAngle(pose, PoseLandmark.RIGHT_SHOULDER, PoseLandmark.RIGHT_ELBOW, PoseLandmark.RIGHT_WRIST)
        if (left == null) return right?.second
        if (right == null) return left.second
        return if (right.first >= left.first) right.second else left.second
    }

    private fun landmarkAngle(pose: Pose, shoulderType: Int, elbowType: Int, wristType: Int): Pair<Float, Double>? {
        val shoulder = pose.getPoseLandmark(shoulderType) ?: return null
        val elbow = pose.getPoseLandmark(elbowType) ?: return null
        val wrist = pose.getPoseLandmark(wristType) ?: return null
        val seen = minOf(shoulder.inFrameLikelihood, elbow.inFrameLikelihood, wrist.inFrameLikelihood)
        if (seen < PushupCounter.MIN_LIKELIHOOD) return null
        val angle = PushupCounter.elbowAngle(
            shoulder.position.x, shoulder.position.y,
            elbow.position.x, elbow.position.y,
            wrist.position.x, wrist.position.y,
        ) ?: return null
        return seen to angle
    }

    private fun addManualRep() {
        if (counter.phase == "up") counter.phase = "down"
        PushupCounter.step(counter, PushupCounter.UP_ANGLE)
        render()
        if (!practice && counter.reps >= target) completeChallenge()
    }

    private fun useManual(reason: String) {
        if (finished) return
        manual = true
        findViewById<PreviewView>(R.id.pushup_preview).visibility = View.GONE
        findViewById<Button>(R.id.pushup_add).visibility = View.VISIBLE
        findViewById<Button>(R.id.pushup_manual).visibility = View.GONE
        findViewById<TextView>(R.id.pushup_note).apply {
            visibility = View.VISIBLE
            text = "$reason This count is on the honor system. Tap once per rep."
        }
        findViewById<TextView>(R.id.pushup_hint).text = "Down, then up, counts as one."
    }

    private fun render() {
        findViewById<TextView>(R.id.pushup_count).text = counter.reps.toString()
    }

    private fun completeChallenge() {
        if (finished) return
        finished = true
        val snap = BlockerSnapshot.read(this)
        val until = System.currentTimeMillis() + snap.unlockMinutes * 60_000L
        if (blockedPackage.isNotBlank()) BlockerSnapshot.grantUnlock(this, blockedPackage, until)
        val event = JSONObject()
        event.put("type", "pushup-unlock")
        event.put("package", blockedPackage)
        event.put("until", Instant.ofEpochMilli(until).toString())
        event.put("reps", counter.reps)
        event.put("max", snap.pushupMax)
        EmberInbox.appendEvent(this, event)
        val launch = if (blockedPackage.isBlank()) null else packageManager.getLaunchIntentForPackage(blockedPackage)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(launch)
        }
        finish()
    }

    private fun finishPractice() {
        if (finished) return
        finished = true
        val snap = BlockerSnapshot.read(this)
        val raised = maxOf(snap.pushupMax, counter.reps).coerceIn(1, 300)
        if (counter.reps > snap.pushupMax) {
            val prefs = getSharedPreferences(EmberBlockerPlugin.PREFS, MODE_PRIVATE)
            val raw = prefs.getString(EmberBlockerPlugin.KEY_SNAPSHOT, "{}") ?: "{}"
            val json = try {
                JSONObject(raw)
            } catch (_: Exception) {
                JSONObject()
            }
            json.put("pushupMax", raised)
            prefs.edit().putString(EmberBlockerPlugin.KEY_SNAPSHOT, json.toString()).apply()
        }
        val event = JSONObject()
        event.put("type", "pushup-max")
        event.put("reps", counter.reps)
        event.put("max", raised)
        EmberInbox.appendEvent(this, event)
        finish()
    }

    private fun cancel() {
        finished = true
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(home)
        finish()
    }

    companion object {
        const val EXTRA_PACKAGE = "package"
        const val EXTRA_PRACTICE = "practice"
        @Volatile var showing: Boolean = false
        @Volatile var lastLaunchMs: Long = 0
    }
}
