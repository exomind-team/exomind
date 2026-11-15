package app.tauri.exomindtimeblockendalert

/** Pure policy exercised on the JVM. Callers serialize it with alarm effects. */
internal class BetaDeadlineGate {
  private var session = ""
  fun activate(token: String) { require(token.isNotEmpty()); session=token }
  fun check(token: String, expiresElapsed: Long, nowElapsed: Long) {
    require(token==session && expiresElapsed>0 && nowElapsed<=expiresElapsed) { "stale deadline alert request" }
  }
  fun capacity(size: Int) { require(size in 0..128) { "deadline alert capacity" } }
  fun receiptCapacity(delivered: Int, new: Int) { require(delivered>=0 && new>=0 && delivered.toLong()+new<=4096) { "deadline alert receipt capacity" } }
}
