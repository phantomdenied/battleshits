package io.github.phantomdenied.battleshits;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Full-screen WebView wrapper that loads the live Battleshits TV page. */
public class MainActivity extends Activity {
    static final String TV_URL = "https://phantomdenied.github.io/battleshits/tv.html?app=1";
    static final String VERSION = "0.1.0"; // keep in sync with VERSION in platform.js

    private WebView web;
    private long lastBack = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // let synthesized audio play without a tap
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " BattleshitsTV/" + VERSION);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        hideSystemUi();
        web.loadUrl(TV_URL);
        web.requestFocus();
    }

    private void showOffline() {
        String html = "<html><body style=\"background:#06142b;color:#e8eef5;font-family:sans-serif;display:flex;"
            + "flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0\">"
            + "<h1 style=\"font-size:48px\">Can&#39;t reach Battleshits</h1>"
            + "<p style=\"font-size:24px;opacity:.7\">Check the TV&#39;s Wi-Fi, then press OK to retry.</p>"
            + "<button autofocus onclick=\"location.href='" + TV_URL + "'\" style=\"font-size:30px;padding:16px 40px;"
            + "border-radius:14px;border:0;background:#e63946;color:#fff;outline:6px solid #ffd166\">Retry</button>"
            + "<script>setTimeout(function(){location.href='" + TV_URL + "'},15000)</script></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            long now = System.currentTimeMillis();
            if (now - lastBack < 2500) { finish(); return true; }
            lastBack = now;
            Toast.makeText(this, "Press BACK again to exit Battleshits", Toast.LENGTH_SHORT).show();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
