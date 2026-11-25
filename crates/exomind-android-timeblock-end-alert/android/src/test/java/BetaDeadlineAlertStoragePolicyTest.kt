package app.tauri.exomindtimeblockendalert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BetaDeadlineAlertStoragePolicyTest {
  @Test
  fun pendingOrPermissionBlockedAlertsRetainCoreTextForRetry() {
    assertEquals(
      BetaDeadlineStoredNotificationText("课程复习", "复习公式"),
      betaDeadlineStoredNotificationText("课程复习", "复习公式", delivered = false),
    )
  }

  @Test
  fun deliveredDeadlineDropsTextAndRepeatedSyncCannotReaddIt() {
    val pending = betaDeadlineStoredNotificationText("课程复习", "复习公式", delivered = false)!!

    assertNull(betaDeadlineStoredNotificationText(pending.blockName, pending.blockNote, delivered = true))
    assertNull(betaDeadlineStoredNotificationText("更新后的名称", "更新后的备注", delivered = true))
  }
}
