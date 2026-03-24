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

  it('defaults to moss and persists volcano when selected', () => {
    expect(VOICE_SHORTCUT_ASR_PROVIDER_VALUES).toEqual(['moss', 'volcano']);
    expect(getVoiceShortcutAsrProvider()).toBe('moss');

    setVoiceShortcutAsrProvider('volcano');

    expect(getVoiceShortcutAsrProvider()).toBe('volcano');
  });
});
