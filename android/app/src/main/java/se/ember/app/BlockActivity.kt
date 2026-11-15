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
            finish()
        }
    }
}