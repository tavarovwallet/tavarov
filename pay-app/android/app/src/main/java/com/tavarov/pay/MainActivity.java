package com.tavarov.pay;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/* Tavarov Pay: the till web app (pay-app/www) in Capacitor's WebView.
   No plugins, no keys, nothing stored outside the WebView's own storage.

   System "Back" first asks the page (window.payGoBack): it closes History or
   Settings and answers true. False means we are on the till itself, and the
   app goes to the background instead of closing, so it reopens instantly. */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        WebView web = (getBridge() != null) ? getBridge().getWebView() : null;
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript(
          "(function(){try{return !!(window.payGoBack && window.payGoBack());}catch(e){return false;}})()",
          value -> { if (!"true".equals(value)) moveTaskToBack(true); });
      }
    });
  }
}
