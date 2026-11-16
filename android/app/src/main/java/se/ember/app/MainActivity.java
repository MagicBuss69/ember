package se.ember.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Ember is in front from the first frame, so the blocker never treats the open as a blocked app.
        EmberGate.setMainStarted(true);
        EmberGate.noteEmberFront();
        registerPlugin(EmberBlockerPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        // Swiping Ember out of recents kills the WebView renderer while the blocker keeps this
        // process alive. Unhandled, WebView then kills the whole process a moment later, which
        // closed Ember right after it was reopened. Handle it and reload with a fresh WebView.
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    handleRendererGone(view, detail);
                    return true;
                }
            });
        }
        lifecycle("onCreate");
    }

    @Override
    public void onStart() {
        EmberGate.setMainStarted(true);
        EmberGate.noteEmberFront();
        super.onStart();
        lifecycle("onStart");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        EmberGate.setMainStarted(true);
        EmberGate.noteEmberFront();
        noteLauncherOpen(intent);
        lifecycle("onNewIntent");
    }

    @Override
    public void onResume() {
        super.onResume();
        EmberGate.setMainStarted(true);
        EmberGate.noteEmberFront();
        noteLauncherOpen(getIntent());
        lifecycle("onResume");
    }

    @Override
    public void onPause() {
        EmberGate.setMainStarted(false);
        EmberGate.noteEmberAway();
        lifecycle("onPause");
        super.onPause();
    }

    @Override
    public void onStop() {
        EmberGate.setMainStarted(false);
        lifecycle("onStop");
        super.onStop();
    }

    @Override
    public void onDestroy() {
        EmberGate.setMainStarted(false);
        lifecycle("onDestroy");
        super.onDestroy();
    }

    @Override
    public void finish() {
        EmberBlockLog.finish("MainActivity", "finish()");
        super.finish();
    }

    @Override
    public void finishAffinity() {
        EmberBlockLog.finish("MainActivity", "finishAffinity()");
        super.finishAffinity();
    }

    @Override
    public void finishAndRemoveTask() {
        EmberBlockLog.finish("MainActivity", "finishAndRemoveTask()");
        super.finishAndRemoveTask();
    }

    @Override
    public boolean moveTaskToBack(boolean nonRoot) {
        EmberBlockLog.moveToBack("MainActivity", "nonRoot=" + nonRoot);
        return super.moveTaskToBack(nonRoot);
    }

    private void handleRendererGone(WebView view, RenderProcessGoneDetail detail) {
        Log.w("EmberBlock", "WebView renderer gone crashed=" + (detail != null && detail.didCrash())
            + " finishing=" + isFinishing());
        try {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view.destroy();
        } catch (Throwable t) {
            Log.w("EmberBlock", "destroy dead WebView failed", t);
        }
        if (isFinishing() || isDestroyed()) return;
        try {
            Intent restart = new Intent(this, MainActivity.class);
            restart.setAction(Intent.ACTION_MAIN);
            restart.addCategory(Intent.CATEGORY_LAUNCHER);
            restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            boolean visible = hasWindowFocus() || getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED);
            finish();
            if (visible) startActivity(restart);
        } catch (Throwable t) {
            Log.w("EmberBlock", "restart after renderer gone failed", t);
        }
    }

    private void lifecycle(String name) {
        Log.i("EmberBlock", "lifecycle MainActivity." + name
            + " task=" + getTaskId()
            + " finishing=" + isFinishing()
            + " configChange=" + isChangingConfigurations());
    }

    private void noteLauncherOpen(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_MAIN.equals(intent.getAction())) return;
        if (intent.getBooleanExtra("ember_open_challenge", false)) return;
        if (intent.getBooleanExtra("ember_confirm_challenge", false)) return;
        EmberGate.noteLauncherOpen(this);
        PushupActivity.dismissForLauncher(getTaskId());
    }
}
