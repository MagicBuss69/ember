package se.ember.app

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class BlockActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_block)
        val snap = BlockerSnapshot.read(this)
        findViewById<TextView>(R.id.block_title).text =
            if (snap.challengeActive) "Challenge open — finish it in Ember" else "Finish today's quests in Ember"
        findViewById<TextView>(R.id.block_body).text =
            "Blocked apps stay locked until every quest (not events) is done."
        findViewById<Button>(R.id.block_open).setOnClickListener {
            val main = Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(main)
            finishReason = "open Ember, close the gate only"
            finish()
        }
    }

    private var finishReason = "unspecified"

    override fun finish() {
        EmberBlockLog.finish("BlockActivity", finishReason)
        super.finish()
    }

    override fun finishAffinity() {
        EmberBlockLog.finish("BlockActivity", "finishAffinity $finishReason")
        super.finishAffinity()
    }

    override fun finishAndRemoveTask() {
        EmberBlockLog.finish("BlockActivity", "finishAndRemoveTask $finishReason")
        super.finishAndRemoveTask()
    }

    override fun moveTaskToBack(nonRoot: Boolean): Boolean {
        EmberBlockLog.moveToBack("BlockActivity", "nonRoot=$nonRoot")
        return super.moveTaskToBack(nonRoot)
    }
}