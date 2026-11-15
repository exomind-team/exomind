package app.tauri.exomindtimeblockendalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimeblockEndAlertBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      -> {
        TimeblockEndAlertState.rescheduleAfterBoot(context)
        runCatching { BetaDeadlineAlerts.rescheduleAfterBoot(context) }.onFailure { android.util.Log.w("ExoMindBetaDeadline", "deadline reminders require recovery", it) }
      }
    }
  }
}
