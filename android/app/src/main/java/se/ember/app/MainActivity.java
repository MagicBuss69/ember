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
    }
}