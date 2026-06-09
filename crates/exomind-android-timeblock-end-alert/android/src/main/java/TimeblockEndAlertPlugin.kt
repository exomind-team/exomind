package app.tauri.exomindtimeblockendalert

import android.Manifest
import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.core.app.NotificationManagerCompat

@InvokeArg
class ScheduleEndAlertArgs {
  lateinit var startId: String
  var title: String = ""
  var dueAt: Long = 0
  var soundEnabled: Boolean = true
  var autoOpenFocus: Boolean = false
}

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
  ],
)
class TimeblockEndAlertPlugin(private val activity: Activity) : Plugin(activity) {
  private val appContext: android.content.Context
    get() = activity.applicationContext

  private fun currentNotificationPermissionState(): String {
    val pluginState = getPermissionState("notifications")
      ?.toString()
      ?.lowercase()

    if (pluginState?.contains("prompt") == true) {
      return "prompt"
    }

    if (pluginState == "denied") {
      return "denied"
    }

    return if (NotificationManagerCompat.from(appContext).areNotificationsEnabled()) {
      "granted"
    } else {
      "denied"
    }
  }

  @Command
  fun scheduleEndAlert(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ScheduleEndAlertArgs::class.java)
      TimeblockEndAlertState.schedule(
        appContext,
        TimeblockEndAlertSchedule(
          startId = args.startId,
          title = args.title,
          dueAt = args.dueAt,
          soundEnabled = args.soundEnabled,
          autoOpenFocus = args.autoOpenFocus,
        ),
      )
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message, error)
    }
  }

  @Command
  fun cancelEndAlert(invoke: Invoke) {
    TimeblockEndAlertState.cancel(appContext)
    invoke.resolve()
  }

  @Command
  fun takePendingHandoff(invoke: Invoke) {
    val handoff = TimeblockEndAlertState.takePendingHandoff(appContext)
    if (handoff == null) {
      invoke.resolve()
      return
    }

    invoke.resolve(
      JSObject()
        .put("kind", handoff.kind)
        .put("startId", handoff.startId)
        .put("source", handoff.source),
    )
  }

  @Command
  fun notificationPermissionState(invoke: Invoke) {
    invoke.resolve(
      JSObject().put("state", currentNotificationPermissionState()),
    )
  }

  @Command
  fun notificationPermissionRequest(invoke: Invoke) {
    if (currentNotificationPermissionState() != "prompt") {
      notificationPermissionState(invoke)
      return
    }

    requestPermissionForAlias("notifications", invoke, "onNotificationPermissionResult")
  }

  @PermissionCallback
  fun onNotificationPermissionResult(invoke: Invoke) {
    notificationPermissionState(invoke)
  }
}
