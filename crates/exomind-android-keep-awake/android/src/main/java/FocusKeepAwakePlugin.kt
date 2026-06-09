package app.tauri.exomindkeepawake

import android.app.Activity
import android.view.WindowManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class KeepAwakeArgs {
  var enabled: Boolean = false
}

@TauriPlugin
class FocusKeepAwakePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setEnabled(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(KeepAwakeArgs::class.java)
      activity.runOnUiThread {
        try {
          if (args.enabled) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          }
          invoke.resolve()
        } catch (error: Exception) {
          invoke.reject(error.message, error)
        }
      }
    } catch (error: Exception) {
      invoke.reject(error.message, error)
    }
  }
}
