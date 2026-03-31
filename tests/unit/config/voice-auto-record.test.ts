import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVoiceAutoRecordEnabled,
  setVoiceAutoRecordEnabled,
  subscribeVoiceAutoRecordChanges,
  VOICE_AUTO_RECORD_KEY,
} from '@/config/voice-auto-record';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('voice auto record config（语音自动记录配置）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    __resetRuntimeConfigCacheForTests();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
      },
    });
  });

  it('defaults to enabled when missing（未设置时默认自动记录）', () => {
    expect(getVoiceAutoRecordEnabled()).toBe(true);
  });

  it('persists and emits custom event（保存并广播自动记录开关）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceAutoRecordChanges(listener);

    expect(setVoiceAutoRecordEnabled(false)).toBe(false);
    expect(storage[VOICE_AUTO_RECORD_KEY]).toBe('0');
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的自动记录开关）', () => {
    storage[VOICE_AUTO_RECORD_KEY] = '0';
    __primeRuntimeConfigForTests({ [VOICE_AUTO_RECORD_KEY]: '1' });

    expect(getVoiceAutoRecordEnabled()).toBe(true);
  });
});
