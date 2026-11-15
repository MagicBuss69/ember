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
        noteLauncherOpen(getIntent());
    }

    private void noteLauncherOpen(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_MAIN.equals(intent.getAction())) return;
        if (intent.getBooleanExtra("ember_open_challenge", false)) return;
        if (intent.getBooleanExtra("ember_confirm_challenge", false)) return;
        EmberGate.noteLauncherOpen(this);
        PushupActivity.dismissForLauncher();
    }
}