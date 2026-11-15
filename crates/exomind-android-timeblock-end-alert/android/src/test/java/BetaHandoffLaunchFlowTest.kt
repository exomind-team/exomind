package app.tauri.exomindtimeblockendalert

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class BetaHandoffLaunchFlowTest {
  @Test fun commitAndMarkerConsumptionPrecedePlainMainLaunchExactlyOnce() {
    var marker=true;var commits=0;var launches=0;var pending:String?=null
    val order=mutableListOf<String>()
    val commit={if(marker){order.add("durable_commit");pending="accepted";commits++;marker=false;order.add("consume_marker");true}else false}
    val launch={assertEquals("accepted",pending);assertFalse(marker);order.add("plain_main");launches++;Unit}
    assertTrue(BetaHandoffLaunchFlow.route(commit,launch))
    assertFalse(BetaHandoffLaunchFlow.route(commit,launch))
    assertEquals(1,commits);assertEquals(1,launches)
    assertEquals(listOf("durable_commit","consume_marker","plain_main"),order)
  }
  @Test fun unknownSourceAndFailedCommitNeverLaunchOrAcknowledge() {
    var launches=0;val p=UUID.randomUUID().toString();val b=UUID.randomUUID().toString();val d=UUID.randomUUID().toString()
    assertFalse(BetaHandoffLaunchFlow.route({BetaHandoffPolicy.accepts(false,p,b,p,b,d)},{launches++}))
    try {BetaHandoffLaunchFlow.route({throw IllegalStateException("synthetic persistence failure")},{launches++});fail("failed commit accepted")}catch (_:IllegalStateException){}
    assertEquals(0,launches)
  }
  @Test fun failedLaunchLeavesCommittedPendingForAnOrdinaryOpen() {
    val id=UUID.randomUUID().toString();var pending:String?=null
    try{BetaHandoffLaunchFlow.route({pending=id;true},{throw IllegalStateException("synthetic launch failure")});fail("launch failure hidden")}catch (_:IllegalStateException){}
    assertEquals(id,pending)
  }
  @Test fun newerTapWinsAndAnOldSourceOrAckCannotReplayOverIt() {
    val first=UUID.randomUUID().toString();val second=UUID.randomUUID().toString();var firstMarker=true;var pending:String?=null
    BetaHandoffLaunchFlow.route({pending=first;firstMarker=false;true},{
      // A second explicit tap may precede an old Main navigation completion.
      BetaHandoffLaunchFlow.route({pending=second;true},{Unit})
    })
    assertEquals(second,pending)
    assertFalse(BetaHandoffPolicy.acknowledge(pending,first));assertEquals(second,pending)
    assertFalse(BetaHandoffLaunchFlow.route({if(firstMarker){pending=first;true}else false},{fail("consumed source launched twice")}))
    assertEquals(second,pending);assertTrue(BetaHandoffPolicy.acknowledge(pending,second))
  }
}
