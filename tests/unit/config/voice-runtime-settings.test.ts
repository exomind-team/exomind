import { beforeEach, describe, expect, it } from 'vitest';

import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceRuntimeAutoSpeakEnabled,
  getVoiceRuntimeCloudSessionPolicy,
  getVoiceRuntimeEnabled,
  getVoiceRuntimeLabNavEnabled,
  getVoiceRuntimeProvider,
  setVoiceRuntimeAutoSpeakEnabled,
  setVoiceRuntimeCloudSessionPolicy,
  setVoiceRuntimeEnabled,
  setVoiceRuntimeLabNavEnabled,
  setVoiceRuntimeProvider,
} from '@/config/voice-runtime-settings';

describe('voice runtime settings（语音运行时设置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses the expected defaults（默认值正确）', () => {
    expect(getVoiceRuntimeEnabled()).toBe(false);
    expect(getVoiceRuntimeProvider()).toBe('doubao-o2-realtime');
    expect(getVoiceRuntimeCloudSessionPolicy()).toBe('on-demand');
    expect(getVoiceRuntimeAutoSpeakEnabled()).toBe(true);
    expect(getVoiceRuntimeLabNavEnabled()).toBe(false);
  });

  it('persists the lightweight settings used by the lab page（保存实验页轻量设置）', () => {
    expect(setVoiceRuntimeEnabled(true)).toBe(true);
    expect(setVoiceRuntimeProvider('doubao-o2-realtime')).toBe('doubao-o2-realtime');
    expect(setVoiceRuntimeCloudSessionPolicy('foreground-persistent')).toBe('foreground-persistent');
    expect(setVoiceRuntimeAutoSpeakEnabled(false)).toBe(false);
    expect(setVoiceRuntimeLabNavEnabled(true)).toBe(true);

    expect(getVoiceRuntimeEnabled()).toBe(true);
    expect(getVoiceRuntimeProvider()).toBe('doubao-o2-realtime');
    expect(getVoiceRuntimeCloudSessionPolicy()).toBe('foreground-persistent');
    expect(getVoiceRuntimeAutoSpeakEnabled()).toBe(false);
    expect(getVoiceRuntimeLabNavEnabled()).toBe(true);
  });

  it('prefers runtime-backed values over localStorage（优先读取 Runtime 配置）', () => {
    window.localStorage.setItem('exomind:voiceRuntimeEnabled', '0');
    window.localStorage.setItem('exomind:voiceRuntimeProvider', 'local-provider');
    window.localStorage.setItem('exomind:voiceRuntimeCloudSessionPolicy', 'on-demand');
    window.localStorage.setItem('exomind:voiceRuntimeAutoSpeakEnabled', '0');
    window.localStorage.setItem('exomind:voiceRuntimeLabNavEnabled', '0');

    __primeRuntimeConfigForTests({
      'exomind:voiceRuntimeEnabled': '1',
      'exomind:voiceRuntimeProvider': 'doubao-o2-realtime',
      'exomind:voiceRuntimeCloudSessionPolicy': 'foreground-persistent',
      'exomind:voiceRuntimeAutoSpeakEnabled': '1',
      'exomind:voiceRuntimeLabNavEnabled': '1',
    });

    expect(getVoiceRuntimeEnabled()).toBe(true);
    expect(getVoiceRuntimeProvider()).toBe('doubao-o2-realtime');
    expect(getVoiceRuntimeCloudSessionPolicy()).toBe('foreground-persistent');
    expect(getVoiceRuntimeAutoSpeakEnabled()).toBe(true);
    expect(getVoiceRuntimeLabNavEnabled()).toBe(true);
  });
});
