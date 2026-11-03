package com.example.multichainwallet;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/* Системная кнопка «Назад».

   Без этого Android закрывал приложение с любого экрана: открыл монету или
   настройки, нажал «назад» — и вылетел на рабочий стол. Теперь кнопка сначала
   спрашивает страницу: та закрывает окно, подэкран или вкладку и отвечает
   true. Ответ false — значит, мы уже на главном, и приложение сворачивается
   (не закрывается: так оно открывается снова мгновенно, как было). */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ShareFilePlugin.class);   // резервная копия в Google Диск
    super.onCreate(savedInstanceState);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        WebView web = (getBridge() != null) ? getBridge().getWebView() : null;
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript(
          "(function(){try{return !!(window.nonGoBack && window.nonGoBack());}catch(e){return false;}})()",
          value -> { if (!"true".equals(value)) moveTaskToBack(true); });
      }
    });
  }
}
