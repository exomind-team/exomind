package app.tauri.exomindtimeblockendalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimeblockEndAlertReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TimeblockEndAlertState.ACTION_FIRE_END_ALERT) {
      return
    }

    val startId = intent.getStringExtra(TimeblockEndAlertState.EXTRA_START_ID)
    val dueAt = intent.getLongExtra(TimeblockEndAlertState.EXTRA_DUE_AT, -1L)
    if (dueAt <= 0L || !TimeblockEndAlertState.matchesCurrentSchedule(context, startId, dueAt)) {
      return
    }

    val schedule = TimeblockEndAlertState.currentSchedule(context) ?: return
    TimeblockEndAlertState.clearFiredSchedule(context)

    if (schedule.soundEnabled) {
      TimeblockEndAlertState.playAlertSound(context)
    }

    TimeblockEndAlertState.showNotification(context, schedule)
    if (schedule.autoOpenFocus) {
      TimeblockEndAlertState.tryAutoOpen(context, schedule)
    }
  }
}
