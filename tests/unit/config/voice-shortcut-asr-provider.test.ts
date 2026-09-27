import { beforeEach, describe, expect, it } from 'vitest';
import {
  getVoiceShortcutAsrProvider,
  setVoiceShortcutAsrProvider,
  VOICE_SHORTCUT_ASR_PROVIDER_VALUES,
} from '@/config/voice-shortcut-asr-provider';

describe('voice-shortcut-asr-provider', () => {
  beforeEach(() => {
    window.localStorage.removeItem('exomind:voiceShortcutAsrProvider');
  });

  it('only supports volcano and always normalizes to volcano', () => {
    expect(VOICE_SHORTCUT_ASR_PROVIDER_VALUES).toEqual(['volcano']);
    expect(getVoiceShortcutAsrProvider()).toBe('volcano');

    // Legacy persisted values must normalize back to volcano.
    window.localStorage.setItem('exomind:voiceShortcutAsrProvider', 'moss');
    expect(getVoiceShortcutAsrProvider()).toBe('volcano');

    setVoiceShortcutAsrProvider('volcano');
    expect(getVoiceShortcutAsrProvider()).toBe('volcano');
  });
});
