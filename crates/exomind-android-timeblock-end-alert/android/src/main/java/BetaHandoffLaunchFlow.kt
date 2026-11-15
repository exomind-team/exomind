package app.tauri.exomindtimeblockendalert

/** Navigation only. Persisting an explicit tap must finish before requesting
 * MainActivity; neither step acknowledges the UI or writes a Core fact.
 * This ordering avoids relying on plugin initialization timing. It does not
 * assert which uncaptured lifecycle event caused an earlier cold-tap failure.
 */
internal object BetaHandoffLaunchFlow {
  fun route(commit: () -> Boolean, launchPlainMain: () -> Unit, trace: (String) -> Unit = {}): Boolean {
    trace("router_commit_requested")
    if (!commit()) {
      trace("router_rejected")
      return false
    }
    trace("router_commit_confirmed")
    launchPlainMain()
    trace("router_main_launch_requested")
    return true
  }
}
