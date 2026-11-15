package se.ember.app;

import android.content.Intent;
import android.os.Bundle;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberBlockerPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        noteLauncherOpen(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        EmberGate.setMainStarted(true);
        noteLauncherOpen(getIntent());
    }

    @Override
    public void onPause() {
        EmberGate.setMainStarted(false);
        super.onPause();
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

    private void noteLauncherOpen(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_MAIN.equals(intent.getAction())) return;
        if (intent.getBooleanExtra("ember_open_challenge", false)) return;
        if (intent.getBooleanExtra("ember_confirm_challenge", false)) return;
        EmberGate.noteLauncherOpen(this);
        PushupActivity.dismissForLauncher(getTaskId());
    }
}