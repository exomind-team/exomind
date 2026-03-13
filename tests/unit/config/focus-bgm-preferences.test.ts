import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('focus bgm preferences（专注背景音偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
      },
    });
  });

  it('defaults to disabled preset playback（默认关闭并使用预设源）', async () => {
    const module = await import('@/config/focus-bgm-preferences');

    expect(module.getFocusBgmPreferences()).toEqual({
      enabled: false,
      sourceType: 'preset',
      presetId: 'white-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 60,
    });
  });

  it('normalizes invalid persisted data（能归一化非法持久化数据）', async () => {
    storage['exomind:focusBgmPreferences'] = JSON.stringify({
      enabled: 'yes',
      sourceType: 'invalid',
      presetId: 'unknown',
      customTracks: [{ path: 'C:/music/a.mp3' }, { path: 1, name: 'bad' }],
      playbackMode: 'invalid',
      stopBehavior: 'invalid',
      volume: 999,
    });

    const module = await import('@/config/focus-bgm-preferences');

    expect(module.getFocusBgmPreferences()).toEqual({
      enabled: false,
      sourceType: 'preset',
      presetId: 'white-noise',
      customTracks: [{ path: 'C:/music/a.mp3', name: 'a.mp3' }],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 100,
    });
  });

  it('persists updates and emits changes（持久化更新并广播变化）', async () => {
    const module = await import('@/config/focus-bgm-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeFocusBgmPreferencesChanges(listener);

    const next = module.updateFocusBgmPreferences({
      enabled: true,
      sourceType: 'custom',
      customTracks: [
        { path: 'D:/music/one.mp3', name: 'one.mp3' },
        { path: 'D:/music/two.mp3', name: 'two.mp3' },
      ],
      playbackMode: 'sequence',
      stopBehavior: 'timer-end',
      volume: 78,
    });

    expect(next.enabled).toBe(true);
    expect(next.sourceType).toBe('custom');
    expect(next.customTracks).toHaveLength(2);
    expect(next.playbackMode).toBe('sequence');
    expect(next.stopBehavior).toBe('timer-end');
    expect(next.volume).toBe(78);
    expect(JSON.parse(storage['exomind:focusBgmPreferences'])).toEqual(next);
    expect(listener).toHaveBeenCalledWith(next);

    unsubscribe();
  });

  it('syncs through storage events（支持 storage 事件同步）', async () => {
    const module = await import('@/config/focus-bgm-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeFocusBgmPreferencesChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:focusBgmPreferences',
      newValue: JSON.stringify({
        enabled: true,
        sourceType: 'preset',
        presetId: 'brown-noise',
        customTracks: [],
        playbackMode: 'loop',
        stopBehavior: 'manual-end',
        volume: 42,
      }),
    }));

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      presetId: 'brown-noise',
      volume: 42,
    }));

    unsubscribe();
  });
});
