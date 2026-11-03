package com.example.multichainwallet;

import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/* Резервная копия в Google Диск одной кнопкой.

   В браузере это делает navigator.share, а во встроенном WebView его нет:
   кнопка молча ничего не открывала. Здесь то же самое средствами Android —
   кладём файл копии во временную папку приложения и открываем системное
   окно «Поделиться», где есть Google Диск, «Файлы» и всё остальное.

   Файл — тот же зашифрованный паролем .tavarov. Он лежит только в кэше
   приложения и стирается при следующей отправке; другим приложениям
   доступен лишь тот, который человек выберет в окне, и только на чтение.

   Ответ { shared: true }, если человек выбрал, куда сохранить. Узнаём это
   через IntentSender окна выбора: результат самого окна Android не
   сообщает. */
@CapacitorPlugin(name = "NonShare")
public class ShareFilePlugin extends Plugin {
  static volatile boolean chosen = false;

  @PluginMethod
  public void shareFile(PluginCall call) {
    String name = call.getString("name");
    String text = call.getString("text");
    if (name == null || text == null) { call.reject("name and text are required"); return; }
    name = name.replaceAll("[^A-Za-z0-9._-]", "_");
    try {
      File dir = new File(getContext().getCacheDir(), "share");
      if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("cannot create the share folder");
      File[] old = dir.listFiles();
      if (old != null) for (File f : old) f.delete();
      File file = new File(dir, name);
      try (FileOutputStream out = new FileOutputStream(file)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
      Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);

      Intent send = new Intent(Intent.ACTION_SEND);
      send.setType("application/octet-stream");
      send.putExtra(Intent.EXTRA_STREAM, uri);
      send.putExtra(Intent.EXTRA_SUBJECT, name);
      send.setClipData(ClipData.newRawUri(name, uri));
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

      chosen = false;
      String title = call.getString("title", "NoN Wallet");
      Intent chooser;
      if (Build.VERSION.SDK_INT >= 22) {
        Intent cb = new Intent(getContext(), ShareChosenReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, cb, flags);
        chooser = Intent.createChooser(send, title, pi.getIntentSender());
      } else {
        chooser = Intent.createChooser(send, title);
        chosen = true;   // на Android 5.0 выбор не узнать: считаем, что сохранили
      }
      startActivityForResult(call, chooser, "shareDone");
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "share failed" : e.getMessage());
    }
  }

  @ActivityCallback
  private void shareDone(PluginCall call, ActivityResult result) {
    if (call == null) return;
    /* Сообщение о выборе может прийти чуть позже, чем закроется окно. */
    new Handler(Looper.getMainLooper()).postDelayed(() -> {
      JSObject o = new JSObject();
      o.put("shared", chosen);
      call.resolve(o);
    }, 400);
  }
}
