package com.example.multichainwallet;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/* Окно «Поделиться» сообщает сюда, что человек выбрал приложение. */
public class ShareChosenReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    ShareFilePlugin.chosen = true;
  }
}
