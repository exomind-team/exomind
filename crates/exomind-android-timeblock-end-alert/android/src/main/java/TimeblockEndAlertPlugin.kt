package app.tauri.exomindtimeblockendalert

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.webkit.WebView
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

@InvokeArg
class BetaDeadlineAlertArgs {
  lateinit var deadlineId: String
  lateinit var profileId: String
  lateinit var blockId: String
  var dueAt: Long = 0
  var remainingMs: Long = 0
  var completed: Boolean = false
}
@InvokeArg
class SyncBetaDeadlinesArgs {
  var alerts: Array<BetaDeadlineAlertArgs> = emptyArray()
  var expiresAtElapsedMs: Long = 0
  var acknowledgeHandoffId: String? = null
  var preserveAlerts: Boolean = false
}

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
  ],
)
class TimeblockEndAlertPlugin(private val activity: Activity) : Plugin(activity) {
  private val betaSession = java.util.UUID.randomUUID().toString()
  init { runCatching { BetaDeadlineAlerts.activate(activity.applicationContext, betaSession) }.onFailure { android.util.Log.w("ExoMindBetaDeadline", "platform reminder state requires recovery", it) } }
  private val appContext: android.content.Context
    get() = activity.applicationContext

  @Command
  fun syncBetaDeadlines(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SyncBetaDeadlinesArgs::class.java)
      invoke.resolve(BetaDeadlineAlerts.sync(appContext, args.alerts.toList(), betaSession, args.expiresAtElapsedMs, args.acknowledgeHandoffId, args.preserveAlerts))
    } catch (error: Exception) { invoke.reject(error.message, error) }
  }

  override fun load(webView: WebView) {
    super.load(webView)
    BetaDeadlineAlerts.traceHandoff("plugin_load")
    handleIntent(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    BetaDeadlineAlerts.traceHandoff("plugin_new_intent")
    handleIntent(intent)
  }

  private fun handleIntent(intent: Intent?) {
    val beta=runCatching { BetaDeadlineAlerts.recordHandoff(appContext,intent) }
      .onFailure { BetaDeadlineAlerts.noteHandoffFailure();android.util.Log.w("ExoMindBetaDeadline","notification handoff was not saved",it) }.getOrDefault(false)
    if(beta) {
      trigger("betaDeadlineHandoffAvailable",JSObject())
      return
    }
    if (!TimeblockEndAlertState.recordPendingHandoffFromIntent(appContext, intent)) {
      return
    }

    trigger(
      "timeblockEndAlertIntent",
      JSObject()
        .put("kind", "timeblock-end-alert"),
    )
  }

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

  @Command
  fun notificationChannelState(invoke: Invoke) {
    try {
      invoke.resolve(BetaDeadlineAlerts.notificationChannelState(appContext, currentNotificationPermissionState()))
    } catch (error: Exception) {
      invoke.reject("Timeblock notification channel status is unavailable", error)
    }
  }

  @Command
  fun openNotificationChannelSettings(invoke: Invoke) {
    try {
      BetaDeadlineAlerts.openNotificationChannelSettings(activity)
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Unable to open timeblock notification channel settings", error)
    }
  }

  @PermissionCallback
  fun onNotificationPermissionResult(invoke: Invoke) {
    notificationPermissionState(invoke)
  }
}
