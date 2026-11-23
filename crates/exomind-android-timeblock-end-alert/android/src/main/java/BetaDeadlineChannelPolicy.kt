package app.tauri.exomindtimeblockendalert

/** Applies the system's default notification sound only to a newly-created
 * channel. Existing channels are user-owned settings and must be left intact.
 */
internal data class DeadlineNotificationSoundPolicy(
  val createChannel: Boolean,
  val applyDefaultSystemSoundToNewChannel: Boolean,
  val applyDefaultSystemSoundToLegacyNotification: Boolean,
)

internal fun deadlineNotificationSoundPolicy(
  channelSupported: Boolean,
  channelAlreadyExists: Boolean,
  defaultSoundAvailable: Boolean,
): DeadlineNotificationSoundPolicy {
  if (!channelSupported) {
    return DeadlineNotificationSoundPolicy(
      createChannel = false,
      applyDefaultSystemSoundToNewChannel = false,
      applyDefaultSystemSoundToLegacyNotification = defaultSoundAvailable,
    )
  }
  return DeadlineNotificationSoundPolicy(
    createChannel = !channelAlreadyExists,
    applyDefaultSystemSoundToNewChannel = !channelAlreadyExists && defaultSoundAvailable,
    applyDefaultSystemSoundToLegacyNotification = false,
  )
}

internal fun deadlineChannelSoundEnabled(
  channelExists: Boolean,
  channelBlocked: Boolean,
  soundUriPresent: Boolean,
): Boolean? = if (!channelExists) null else !channelBlocked && soundUriPresent
