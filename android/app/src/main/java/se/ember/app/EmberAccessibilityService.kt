package se.ember.app

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

class EmberAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return
        val snap = BlockerSnapshot.read(this)
        val until = BlockerSnapshot.unlockUntil(this, pkg)
        if (!snap.shouldBlock(pkg, until)) return
        if (PushupActivity.showing) return
        val now = System.currentTimeMillis()
        if (now - PushupActivity.lastLaunchMs < 1500) return
        PushupActivity.lastLaunchMs = now
        performGlobalAction(GLOBAL_ACTION_HOME)
        val target = if (snap.blockMode == "quests") BlockActivity::class.java else PushupActivity::class.java
        val block = Intent(this, target)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(PushupActivity.EXTRA_PACKAGE, pkg)
        startActivity(block)
    }

    override fun onInterrupt() {}
}