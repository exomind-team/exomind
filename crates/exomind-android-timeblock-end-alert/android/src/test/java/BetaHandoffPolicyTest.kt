package app.tauri.exomindtimeblockendalert
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class BetaHandoffPolicyTest {
  @Test fun tapRequiresLocallyDeliveredDeadlineAndExactStoredSource() {
    val p=UUID.randomUUID().toString();val b=UUID.randomUUID().toString();val d=UUID.randomUUID().toString()
    assertTrue(BetaHandoffPolicy.accepts(true,p,b,p,b,d))
    assertFalse(BetaHandoffPolicy.accepts(false,p,b,p,b,d))
    assertFalse(BetaHandoffPolicy.accepts(true,null,null,p,b,d))
    assertFalse(BetaHandoffPolicy.accepts(true,p,b,UUID.randomUUID().toString(),b,d))
    assertFalse(BetaHandoffPolicy.accepts(true,p,b,p,UUID.randomUUID().toString(),d))
    assertFalse(BetaHandoffPolicy.accepts(true,p,b,p,b,"00000000-0000-0000-0000-000000000000"))
  }
  @Test fun oldAcknowledgementCannotClearNewTapOrAnEmptySlot() {
    val first=UUID.randomUUID().toString();val second=UUID.randomUUID().toString()
    assertTrue(BetaHandoffPolicy.acknowledge(first,first))
    assertFalse(BetaHandoffPolicy.acknowledge(second,first))
    assertFalse(BetaHandoffPolicy.acknowledge(null,first))
    assertFalse(BetaHandoffPolicy.acknowledge(first,null))
    assertFalse(BetaHandoffPolicy.acknowledge(first,"malformed"))
  }
}
