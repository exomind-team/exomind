package app.tauri.exomindrtkeepalive

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class KeepaliveArgs {
  var enabled: Boolean = false
  var title: String? = null
  var text: String? = null
}

@TauriPlugin
class RuntimeKeepalivePlugin(private val activity: Activity) : Plugin(activity) {
    private val appContext: Context
        get() = activity.applicationContext

    @Command
    fun setEnabled(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(KeepaliveArgs::class.java)
            RuntimeKeepaliveState.setEnabled(
                appContext,
                args.enabled,
                args.title,
                args.text,
            )

            if (args.enabled) {
                RuntimeKeepaliveState.stopService(appContext)
            } else {
                RuntimeKeepaliveState.stopService(appContext)
            }

            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message, ex)
        }
    }

    override fun onStop() {
        if (RuntimeKeepaliveState.isEnabled(appContext)) {
            RuntimeKeepaliveState.startService(appContext)
        }
    }

    override fun onResume() {
        RuntimeKeepaliveState.stopService(appContext)
    }
}

internal object RuntimeKeepaliveState {
    private const val PREFS_NAME = "exomind.runtime.keepalive"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_TITLE = "title"
    private const val KEY_TEXT = "text"
    private const val DEFAULT_TITLE = "ExoMind RT 正在后台运行"
    private const val DEFAULT_TEXT = "保持 RT 可连接，并继续处理请求与事件。"

    fun isEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_ENABLED, false)
    }

    fun setEnabled(context: Context, enabled: Boolean, title: String?, text: String?) {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_TITLE, title ?: DEFAULT_TITLE)
            .putString(KEY_TEXT, text ?: DEFAULT_TEXT)
            .apply()
    }

    fun startService(context: Context) {
        val serviceIntent = serviceIntent(context)
        ContextCompat.startForegroundService(context, serviceIntent)
    }

    fun stopService(context: Context) {
        context.stopService(serviceIntent(context))
    }

    fun notificationTitle(context: Context): String {
        return prefs(context).getString(KEY_TITLE, DEFAULT_TITLE) ?: DEFAULT_TITLE
    }

    fun notificationText(context: Context): String {
        return prefs(context).getString(KEY_TEXT, DEFAULT_TEXT) ?: DEFAULT_TEXT
    }

    private fun serviceIntent(context: Context): Intent {
        return Intent(context, RuntimeKeepaliveService::class.java).apply {
            putExtra(RuntimeKeepaliveService.EXTRA_TITLE, notificationTitle(context))
            putExtra(RuntimeKeepaliveService.EXTRA_TEXT, notificationText(context))
        }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
