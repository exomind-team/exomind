package app.tauri.exomindclipboard

import androidx.core.content.FileProvider

/** Keep the narrow original cache separate from Tauri's own FileProvider.
 * Android merges provider declarations by class name, even across authorities. */
class BetaOriginalFileProvider : FileProvider()
