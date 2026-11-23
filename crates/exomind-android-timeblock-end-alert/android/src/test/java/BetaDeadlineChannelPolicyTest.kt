package app.tauri.exomindtimeblockendalert

import org.junit.Assert.assertEquals
import org.junit.Test

class BetaDeadlineChannelPolicyTest {
  @Test
  fun newAndroidOChannelUsesTheSystemDefaultSoundWhenAvailable() {
    assertEquals(
      DeadlineNotificationSoundPolicy(
        createChannel = true,
        applyDefaultSystemSoundToNewChannel = true,
        applyDefaultSystemSoundToLegacyNotification = false,
      ),
      deadlineNotificationSoundPolicy(channelSupported = true, channelAlreadyExists = false, defaultSoundAvailable = true),
    )
  }

  @Test
  fun preAndroidOUsesTheGlobalSystemNotificationSoundOnEachNotification() {
    assertEquals(
      DeadlineNotificationSoundPolicy(
        createChannel = false,
        applyDefaultSystemSoundToNewChannel = false,
        applyDefaultSystemSoundToLegacyNotification = true,
      ),
      deadlineNotificationSoundPolicy(channelSupported = false, channelAlreadyExists = false, defaultSoundAvailable = true),
    )
  }

  @Test
  fun missingSystemDefaultDoesNotInventAnAudioResource() {
    assertEquals(
      DeadlineNotificationSoundPolicy(
        createChannel = true,
        applyDefaultSystemSoundToNewChannel = false,
        applyDefaultSystemSoundToLegacyNotification = false,
      ),
      deadlineNotificationSoundPolicy(channelSupported = true, channelAlreadyExists = false, defaultSoundAvailable = false),
    )
    assertEquals(
      DeadlineNotificationSoundPolicy(
        createChannel = false,
        applyDefaultSystemSoundToNewChannel = false,
        applyDefaultSystemSoundToLegacyNotification = false,
      ),
      deadlineNotificationSoundPolicy(channelSupported = false, channelAlreadyExists = false, defaultSoundAvailable = false),
    )
  }

  @Test
  fun existingChannelAlwaysPreservesTheUsersSoundOrMuteChoice() {
    listOf(true, false).forEach { defaultSoundAvailable ->
      assertEquals(
        DeadlineNotificationSoundPolicy(
          createChannel = false,
          applyDefaultSystemSoundToNewChannel = false,
          applyDefaultSystemSoundToLegacyNotification = false,
        ),
        deadlineNotificationSoundPolicy(channelSupported = true, channelAlreadyExists = true, defaultSoundAvailable = defaultSoundAvailable),
      )
    }
  }

  @Test
  fun soundStateIsUnknownUntilChannelExistsAndRespectsBlockedChannels() {
    assertEquals(null, deadlineChannelSoundEnabled(channelExists = false, channelBlocked = false, soundUriPresent = false))
    assertEquals(false, deadlineChannelSoundEnabled(channelExists = true, channelBlocked = true, soundUriPresent = true))
    assertEquals(false, deadlineChannelSoundEnabled(channelExists = true, channelBlocked = false, soundUriPresent = false))
    assertEquals(true, deadlineChannelSoundEnabled(channelExists = true, channelBlocked = false, soundUriPresent = true))
  }
}
