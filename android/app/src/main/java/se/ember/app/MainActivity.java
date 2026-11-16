package se.ember.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Ember is in front from the first frame, so the blocker never treats the open as a blocked app.
        EmberGate.setMainStarted(true);
        EmberGate.noteEmberFront();
        registerPlugin(EmberBlockerPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
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
