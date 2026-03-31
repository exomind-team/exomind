import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTimerPreferences,
  setTimerPreferences,
  subscribeTimerPreferencesChanges,
} from '@/config/timer-preferences';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('timer preferences（计时器偏好）', () => {
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

  it('defaults to soft mode with sound enabled（默认软结束并开启提示音）', () => {
    expect(getTimerPreferences()).toEqual({
      countdownEndMode: 'soft',
      countdownEndSoundEnabled: true,
      countdownEndSoundPresetId: 'dang',
    });
  });

  it('persists and emits custom event（持久化并广播计时器偏好）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimerPreferencesChanges(listener);

    setTimerPreferences({
      countdownEndMode: 'hard',
      countdownEndSoundEnabled: false,
      countdownEndSoundPresetId: 'dang',
    });

    expect(storage['exomind:timerPreferences']).toBe(
      '{"countdownEndMode":"hard","countdownEndSoundEnabled":false,"countdownEndSoundPresetId":"dang"}',
    );
    expect(listener).toHaveBeenCalledWith({
      countdownEndMode: 'hard',
      countdownEndSoundEnabled: false,
      countdownEndSoundPresetId: 'dang',
    });
    unsubscribe();
  });

  it('reads runtime-backed preferences before localStorage（优先读取 Runtime 中的计时器偏好）', () => {
    storage['exomind:timerPreferences'] = '{"countdownEndMode":"soft","countdownEndSoundEnabled":true,"countdownEndSoundPresetId":"digital-watch"}';
    __primeRuntimeConfigForTests({
      'exomind:timerPreferences': '{"countdownEndMode":"hard","countdownEndSoundEnabled":false,"countdownEndSoundPresetId":"dang"}',
    });

    expect(getTimerPreferences()).toEqual({
      countdownEndMode: 'hard',
      countdownEndSoundEnabled: false,
      countdownEndSoundPresetId: 'dang',
    });
  });
});
