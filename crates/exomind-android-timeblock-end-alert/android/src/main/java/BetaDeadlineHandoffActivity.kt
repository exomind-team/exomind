package app.tauri.exomindtimeblockendalert

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

/** A notification Activity target, not a receiver/service trampoline. The
 * same bounded private handoff slot is committed without a WebView, plugin,
 * Rust runtime or foreground profile. NoDisplay finishes inside onCreate.
 */
class BetaDeadlineHandoffActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    route(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    route(intent)
  }

  private fun route(source: Intent?) {
    var profile: String? = null
    var block: String? = null
    var deadline: String? = null
    var committed = false
    fun trace(stage: String) = BetaDeadlineAlerts.traceHandoff(stage, profileId = profile, blockId = block, deadlineId = deadline)
    try {
      profile = source?.getStringExtra("betaProfileId")
      block = source?.getStringExtra("betaBlockId")
      deadline = source?.data?.lastPathSegment
      trace("router_created")
      BetaHandoffLaunchFlow.route(
        commit = {
          // recordHandoff validates known local delivery scope, durably stores
          // one latest-tap slot, then consumes this Intent's Beta markers.
          BetaDeadlineAlerts.recordHandoff(applicationContext, source).also { committed = it }
        },
        launchPlainMain = {
          val main = packageManager.getLaunchIntentForPackage(packageName)
            ?: throw IllegalStateException("Main launch target unavailable")
          check(main.component?.packageName == packageName && main.component?.className != javaClass.name)
          main.action = Intent.ACTION_MAIN
          main.data = null
          main.replaceExtras(Bundle())
          main.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
          // Main receives no Beta URI/extras: plugin.load/onNewIntent cannot
          // manufacture a second handoff or overwrite a newer tap from it.
          startActivity(main)
        },
        trace = ::trace,
      )
    } catch (error: Exception) {
      // A committed slot survives a failed Activity launch and is available
      // on the user's next ordinary app open. Never turn it into an ACK.
      if (!committed) BetaDeadlineAlerts.noteHandoffFailure()
      trace(if (committed) "router_launch_failed" else "router_commit_failed")
      Log.w("ExoMindBetaHandoff", "stage=router_failed kind=${error.javaClass.simpleName}")
    } finally {
      trace("router_finish")
      finish()
    }
  }
}
