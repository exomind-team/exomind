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

  it('defaults to moss and persists qwen-omni when selected', () => {
    expect(VOICE_SHORTCUT_ASR_PROVIDER_VALUES).toEqual(['moss', 'volcano', 'qwen-omni']);
    expect(getVoiceShortcutAsrProvider()).toBe('moss');

    setVoiceShortcutAsrProvider('qwen-omni');

    expect(getVoiceShortcutAsrProvider()).toBe('qwen-omni');
  });
});
