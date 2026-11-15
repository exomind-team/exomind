package app.tauri.exomindtimeblockendalert
import org.junit.Assert.*
import org.junit.Test

class BetaDeadlineGateTest {
  private fun rejected(block:()->Unit) { try {block();fail("stale/over-capacity request accepted")} catch (_:IllegalArgumentException) {} }
  @Test fun expiredOrPreviousRuntimeCannotRescheduleAfterTimeoutAndRestart() {
    val gate=BetaDeadlineGate();gate.activate("runtime-A")
    gate.check("runtime-A",5000,4999)
    rejected {gate.check("runtime-A",5000,6000)}
    // This is elapsed time: changing civil/wall time never changes the test.
    gate.activate("runtime-B")
    rejected {gate.check("runtime-A",10000,6000)}
    gate.check("runtime-B",10000,6000)
  }
  @Test fun capacityIsExplicitAndNeverReturnsAPartialList() {
    val gate=BetaDeadlineGate();gate.capacity(128);rejected {gate.capacity(129)}
    gate.receiptCapacity(4095,1);rejected {gate.receiptCapacity(4096,1)}
    gate.receiptCapacity(4096,0)
  }
}
