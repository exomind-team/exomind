import { beforeEach, describe, expect, it } from 'vitest';

import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceRuntimeMode,
  setVoiceRuntimeMode,
  VOICE_RUNTIME_MODE_VALUES,
} from '@/config/voice-runtime-mode';

describe('voice runtime mode（语音运行时模式配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses off as the default mode（默认模式为关闭）', () => {
    expect(VOICE_RUNTIME_MODE_VALUES).toEqual(['off', 'push-to-talk', 'ambient']);
    expect(getVoiceRuntimeMode()).toBe('off');
  });

  it('persists mode changes（保存模式切换）', () => {
    expect(setVoiceRuntimeMode('ambient')).toBe('ambient');
    expect(getVoiceRuntimeMode()).toBe('ambient');

    expect(setVoiceRuntimeMode('push-to-talk')).toBe('push-to-talk');
    expect(getVoiceRuntimeMode()).toBe('push-to-talk');
  });

  it('prefers runtime-backed values over localStorage（优先读取 Runtime 配置）', () => {
    window.localStorage.setItem('exomind:voiceRuntimeMode', 'push-to-talk');
    __primeRuntimeConfigForTests({
      'exomind:voiceRuntimeMode': 'ambient',
    });

    expect(getVoiceRuntimeMode()).toBe('ambient');
  });
});
