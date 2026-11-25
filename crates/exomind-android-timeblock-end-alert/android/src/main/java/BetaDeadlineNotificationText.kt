package app.tauri.exomindtimeblockendalert

internal data class BetaDeadlineNotificationContent(val title: String, val body: String)

/**
 * Validates the bounded, one-line text projection sent by Core/Native and
 * supplies a safe presentation fallback for an older persisted alert entry.
 */
internal object BetaDeadlineNotificationText {
  const val MAX_TITLE_BYTES = 256
  const val MAX_NOTE_BYTES = 512

  private const val EMPTY_TITLE = "未命名时间块"
  private const val EMPTY_NOTE_BODY = "时间块已到点，打开外心查看状态"
  private const val ELLIPSIS = "…"

  fun isValidProjection(blockName: String, blockNote: String): Boolean =
    project(blockName, MAX_TITLE_BYTES, EMPTY_TITLE, allowEmpty = false) == blockName
      && project(blockNote, MAX_NOTE_BYTES, "", allowEmpty = true) == blockNote

  fun content(blockName: String?, blockNote: String?): BetaDeadlineNotificationContent {
    val title = project(blockName.orEmpty(), MAX_TITLE_BYTES, EMPTY_TITLE, allowEmpty = false)
    val note = project(blockNote.orEmpty(), MAX_NOTE_BYTES, "", allowEmpty = true)
    return BetaDeadlineNotificationContent(title, note.ifEmpty { EMPTY_NOTE_BODY })
  }

  private fun project(value: String, maxBytes: Int, fallback: String, allowEmpty: Boolean): String {
    val output = StringBuilder()
    var outputBytes = 0
    var pendingSpace = false
    var truncated = false
    var offset = 0

    while (offset < value.length) {
      val codePoint = value.codePointAt(offset)
      offset += Character.charCount(codePoint)

      if (codePoint in 0xd800..0xdfff) continue
      if (isBidiControl(codePoint)) continue
      if (Character.isISOControl(codePoint)
        || Character.isWhitespace(codePoint)
        || Character.isSpaceChar(codePoint)
      ) {
        pendingSpace = output.isNotEmpty()
        continue
      }

      val characterBytes = utf8Length(codePoint)
      val separatorBytes = if (pendingSpace) 1 else 0
      if (outputBytes + separatorBytes + characterBytes > maxBytes) {
        truncated = true
        break
      }
      if (pendingSpace) {
        output.append(' ')
        outputBytes++
      }
      output.appendCodePoint(codePoint)
      outputBytes += characterBytes
      pendingSpace = false
    }

    if (truncated) {
      val ellipsisBytes = utf8Length(ELLIPSIS.codePointAt(0))
      while (outputBytes + ellipsisBytes > maxBytes && output.isNotEmpty()) {
        val lastCodePoint = output.codePointBefore(output.length)
        val lastCharacterCount = Character.charCount(lastCodePoint)
        if (lastCodePoint == ' '.code) {
          output.deleteCharAt(output.length - 1)
          outputBytes--
        } else {
          output.delete(output.length - lastCharacterCount, output.length)
          outputBytes -= utf8Length(lastCodePoint)
        }
      }
      if (outputBytes + ellipsisBytes <= maxBytes) output.append(ELLIPSIS)
    }

    val projected = output.toString().trim()
    return if (projected.isEmpty()) {
      if (allowEmpty) "" else fallback
    } else projected
  }

  private fun utf8Length(codePoint: Int): Int = when {
    codePoint <= 0x7f -> 1
    codePoint <= 0x7ff -> 2
    codePoint <= 0xffff -> 3
    else -> 4
  }

  private fun isBidiControl(codePoint: Int): Boolean =
    codePoint == 0x061c
      || codePoint == 0x200e
      || codePoint == 0x200f
      || codePoint in 0x202a..0x202e
      || codePoint in 0x2066..0x2069
}
