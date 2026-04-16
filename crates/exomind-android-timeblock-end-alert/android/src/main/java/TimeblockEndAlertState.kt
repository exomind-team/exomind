package app.tauri.exomindtimeblockendalert

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.UUID

data class TimeblockEndAlertSchedule(
  val startId: String,
  val title: String,
  val dueAt: Long,
  val soundEnabled: Boolean,
  val autoOpenFocus: Boolean,
)

data class PendingTimeblockEndAlertHandoff(
  val kind: String = "timeblock-end-alert",
  val startId: String?,
  val source: String,
)

object TimeblockEndAlertState {
  const val ACTION_FIRE_END_ALERT = "com.exomind.app.action.TIMEBLOCK_END_ALERT_FIRE"
  const val ACTION_OPEN_FOCUS = "com.exomind.app.action.TIMEBLOCK_END_ALERT_OPEN_FOCUS"
  const val EXTRA_START_ID = "startId"
  const val EXTRA_TITLE = "title"
  const val EXTRA_DUE_AT = "dueAt"
  const val EXTRA_SOUND_ENABLED = "soundEnabled"
  const val EXTRA_AUTO_OPEN_FOCUS = "autoOpenFocus"
  private const val PREFS_NAME = "exomind.timeblock.end.alert"
  private const val KEY_START_ID = "start_id"
  private const val KEY_TITLE = "title"
  private const val KEY_DUE_AT = "due_at"
  private const val KEY_SOUND_ENABLED = "sound_enabled"
  private const val KEY_AUTO_OPEN_FOCUS = "auto_open_focus"
  private const val KEY_PENDING_START_ID = "pending_start_id"
  private const val KEY_PENDING_SOURCE = "pending_source"
  private const val KEY_HANDOFF_TOKEN = "handoff_token"
  private const val REQUEST_CODE_ALARM = 1571
  private const val REQUEST_CODE_OPEN = 1572
  private const val NOTIFICATION_ID = 1571
  private const val CHANNEL_ID = "exomind_timeblock_end_alert"
  private const val CHANNEL_NAME = "ExoMind 时间块结束提醒"
  private const val CHANNEL_DESCRIPTION = "用于在 Android 后台提醒时间块倒计时已经结束。"
  private const val AUTO_OPEN_CHANNEL_ID = "exomind_timeblock_end_alert_autofocus"
  private const val AUTO_OPEN_CHANNEL_NAME = "ExoMind 时间块结束自动回开"
  private const val AUTO_OPEN_CHANNEL_DESCRIPTION = "用户启用后，时间块倒计时在后台结束时尝试直接回到当下/专注。"
  private const val LOG_TAG = "ExoMindTimeblockEnd"

  fun schedule(context: Context, schedule: TimeblockEndAlertSchedule) {
    prefs(context).edit()
      .putString(KEY_START_ID, schedule.startId)
      .putString(KEY_TITLE, schedule.title)
      .putLong(KEY_DUE_AT, schedule.dueAt)
      .putBoolean(KEY_SOUND_ENABLED, schedule.soundEnabled)
      .putBoolean(KEY_AUTO_OPEN_FOCUS, schedule.autoOpenFocus)
      .putString(KEY_HANDOFF_TOKEN, UUID.randomUUID().toString())
      .apply()

    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = alarmPendingIntent(context, schedule)
    if (canScheduleExactAlarm(alarmManager)) {
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        schedule.dueAt,
        pendingIntent,
      )
      return
    }

    Log.w(LOG_TAG, "exact alarm unavailable, falling back to inexact while-idle alarm")
    alarmManager.setAndAllowWhileIdle(
      AlarmManager.RTC_WAKEUP,
      schedule.dueAt,
      pendingIntent,
    )
  }

  fun cancel(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    if (alarmManager != null) {
      alarmManager.cancel(alarmPendingIntent(context, currentSchedule(context)))
    }

    prefs(context).edit()
      .remove(KEY_START_ID)
      .remove(KEY_TITLE)
      .remove(KEY_DUE_AT)
      .remove(KEY_SOUND_ENABLED)
      .remove(KEY_AUTO_OPEN_FOCUS)
      .remove(KEY_HANDOFF_TOKEN)
      .apply()
  }

  fun currentSchedule(context: Context): TimeblockEndAlertSchedule? {
    val rawStartId = prefs(context).getString(KEY_START_ID, null)?.trim().orEmpty()
    val rawTitle = prefs(context).getString(KEY_TITLE, null)?.trim().orEmpty()
    val dueAt = prefs(context).getLong(KEY_DUE_AT, -1L)
    if (rawStartId.isEmpty() || dueAt <= 0L) {
      return null
    }

    return TimeblockEndAlertSchedule(
      startId = rawStartId,
      title = if (rawTitle.isEmpty()) "未命名时间块" else rawTitle,
      dueAt = dueAt,
      soundEnabled = prefs(context).getBoolean(KEY_SOUND_ENABLED, true),
      autoOpenFocus = prefs(context).getBoolean(KEY_AUTO_OPEN_FOCUS, false),
    )
  }

  fun matchesCurrentSchedule(context: Context, startId: String?, dueAt: Long): Boolean {
    val current = currentSchedule(context) ?: return false
    return current.startId == startId && current.dueAt == dueAt
  }

  fun clearFiredSchedule(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    if (alarmManager != null) {
      alarmManager.cancel(alarmPendingIntent(context, currentSchedule(context)))
    }

    prefs(context).edit()
      .remove(KEY_START_ID)
      .remove(KEY_TITLE)
      .remove(KEY_DUE_AT)
      .remove(KEY_SOUND_ENABLED)
      .remove(KEY_AUTO_OPEN_FOCUS)
      .apply()
  }

  fun takePendingHandoff(context: Context): PendingTimeblockEndAlertHandoff? {
    val source = prefs(context).getString(KEY_PENDING_SOURCE, null)?.trim().orEmpty()
    if (source.isEmpty()) {
      return null
    }

    val startId = prefs(context).getString(KEY_PENDING_START_ID, null)?.trim()?.ifEmpty { null }
    prefs(context).edit()
      .remove(KEY_PENDING_START_ID)
      .remove(KEY_PENDING_SOURCE)
      .remove(KEY_HANDOFF_TOKEN)
      .apply()
    return PendingTimeblockEndAlertHandoff(
      startId = startId,
      source = source,
    )
  }

  fun recordPendingHandoffFromIntent(context: Context, intent: Intent?): Boolean {
    if (intent?.action != ACTION_OPEN_FOCUS) {
      return false
    }

    val expectedToken = prefs(context).getString(KEY_HANDOFF_TOKEN, null)?.trim().orEmpty()
    val actualToken = intent.getStringExtra("handoffToken")?.trim().orEmpty()
    if (expectedToken.isEmpty() || expectedToken != actualToken) {
      Log.w(LOG_TAG, "rejected timeblock end handoff with invalid token")
      return false
    }

    val source = intent.getStringExtra("source")?.trim()?.ifEmpty { null }
      ?: if (intent.getBooleanExtra(EXTRA_AUTO_OPEN_FOCUS, false)) "auto-open" else "notification"
    val startId = intent.getStringExtra(EXTRA_START_ID)?.trim()?.ifEmpty { null }

    prefs(context).edit()
      .putString(KEY_PENDING_SOURCE, source)
      .putString(KEY_PENDING_START_ID, startId)
      .apply()
    intent.action = null
    intent.removeExtra(EXTRA_START_ID)
    intent.removeExtra("source")
    intent.removeExtra("handoffToken")
    intent.removeExtra(EXTRA_AUTO_OPEN_FOCUS)
    return true
  }

  fun rescheduleAfterBoot(context: Context) {
    val schedule = currentSchedule(context) ?: return
    if (schedule.dueAt <= System.currentTimeMillis()) {
      cancel(context)
      return
    }

    schedule(context, schedule)
  }

  fun notificationPermissionState(context: Context): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return "granted"
    }

    val granted = NotificationManagerCompat.from(context).areNotificationsEnabled()
    return if (granted) "granted" else "prompt"
  }

  fun playAlertSound(context: Context) {
    val ringtoneUri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_NOTIFICATION)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      ?: return

    runCatching {
      RingtoneManager.getRingtone(context, ringtoneUri)?.play()
    }.onFailure { error ->
      Log.w(LOG_TAG, "failed to play alert ringtone", error)
    }
  }

  fun showNotification(context: Context, schedule: TimeblockEndAlertSchedule): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      return false
    }

    createNotificationChannels(context)
    val openIntent = openFocusIntent(context, schedule.startId, autoOpen = false)
    val pendingIntent = PendingIntent.getActivity(
      context,
      REQUEST_CODE_OPEN,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val channelId = if (schedule.autoOpenFocus) AUTO_OPEN_CHANNEL_ID else CHANNEL_ID
    val notification = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("时间块倒计时结束")
      .setContentText("${schedule.title} 已到点，点击回到当下/专注")
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setSilent(true)
      .setContentIntent(pendingIntent)
      .apply {
        if (schedule.autoOpenFocus) {
          setFullScreenIntent(pendingIntent, true)
        }
      }
      .build()

    return runCatching {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
      true
    }.getOrElse { error ->
      Log.w(LOG_TAG, "failed to notify timeblock end alert", error)
      false
    }
  }

  fun tryAutoOpen(context: Context, schedule: TimeblockEndAlertSchedule): Boolean {
    if (!schedule.autoOpenFocus) {
      return false
    }

    return runCatching {
      context.startActivity(openFocusIntent(context, schedule.startId, autoOpen = true))
      true
    }.getOrElse { error ->
      Log.w(LOG_TAG, "failed to auto-open focus route after timeblock end", error)
      false
    }
  }

  private fun canScheduleExactAlarm(alarmManager: AlarmManager): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return true
    }

    return runCatching { alarmManager.canScheduleExactAlarms() }
      .getOrElse { error ->
        Log.w(LOG_TAG, "failed to query exact alarm capability", error)
        false
      }
  }

  private fun createNotificationChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = NotificationManagerCompat.from(context)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
        description = CHANNEL_DESCRIPTION
        setShowBadge(false)
        setSound(null, null)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(AUTO_OPEN_CHANNEL_ID, AUTO_OPEN_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
        description = AUTO_OPEN_CHANNEL_DESCRIPTION
        setShowBadge(false)
        setSound(null, null)
      },
    )
  }

  private fun alarmPendingIntent(context: Context, schedule: TimeblockEndAlertSchedule?): PendingIntent {
    return PendingIntent.getBroadcast(
      context,
      REQUEST_CODE_ALARM,
      Intent(context, TimeblockEndAlertReceiver::class.java).apply {
        action = ACTION_FIRE_END_ALERT
        putExtra(EXTRA_START_ID, schedule?.startId)
        putExtra(EXTRA_TITLE, schedule?.title)
        putExtra(EXTRA_DUE_AT, schedule?.dueAt ?: -1L)
        putExtra(EXTRA_SOUND_ENABLED, schedule?.soundEnabled ?: false)
        putExtra(EXTRA_AUTO_OPEN_FOCUS, schedule?.autoOpenFocus ?: false)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun openFocusIntent(context: Context, startId: String, autoOpen: Boolean): Intent {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: throw IllegalStateException("launch intent unavailable for ${context.packageName}")
    val handoffToken = prefs(context).getString(KEY_HANDOFF_TOKEN, null)?.trim().orEmpty()
    if (handoffToken.isEmpty()) {
      throw IllegalStateException("handoff token unavailable for ${context.packageName}")
    }

    return launchIntent.apply {
      action = ACTION_OPEN_FOCUS
      putExtra(EXTRA_START_ID, startId)
      putExtra("source", if (autoOpen) "auto-open" else "notification")
      putExtra("handoffToken", handoffToken)
      putExtra(EXTRA_AUTO_OPEN_FOCUS, autoOpen)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
