package app.tauri.exomindtimeblockendalert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BetaDeadlineNotificationTextTest {
  @Test
  fun notificationUsesTheCoreBlockNameAndNote() {
    val content = BetaDeadlineNotificationText.content("课程复习", "复习公式和例题")

    assertEquals("课程复习", content.title)
    assertEquals("复习公式和例题", content.body)
    assertTrue(BetaDeadlineNotificationText.isValidProjection("课程复习", "复习公式和例题"))
  }

  @Test
  fun notificationTextIsOneLineAndFallsBackForAnEmptyNote() {
    val content = BetaDeadlineNotificationText.content("课程\n复习", "\n\u0007\t")

    assertEquals("课程 复习", content.title)
    assertEquals("时间块已到点，打开外心查看状态", content.body)
    assertFalse(BetaDeadlineNotificationText.isValidProjection("课程\n复习", "备注"))
  }

  @Test
  fun longUnicodeTextIsBoundedWithoutSplittingCodePoints() {
    val content = BetaDeadlineNotificationText.content("计划📚".repeat(200), "复习".repeat(1000))

    assertTrue(content.title.toByteArray(Charsets.UTF_8).size <= BetaDeadlineNotificationText.MAX_TITLE_BYTES)
    assertTrue(content.body.toByteArray(Charsets.UTF_8).size <= BetaDeadlineNotificationText.MAX_NOTE_BYTES)
    assertTrue(content.title.endsWith("…"))
    assertTrue(content.body.endsWith("…"))
    assertTrue(BetaDeadlineNotificationText.isValidProjection(content.title, "复习".repeat(50)))
    assertFalse(BetaDeadlineNotificationText.isValidProjection("超长".repeat(200), "备注"))
  }
}
