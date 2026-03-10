import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_OVERLAY_OPACITY,
  getVoiceOverlayOpacity,
  setVoiceOverlayOpacity,
  subscribeVoiceOverlayOpacityChanges,
} from '@/config/voice-overlay-preferences';

describe('voice overlay preferences（语音悬浮窗偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
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

  it('defaults to configured opacity（默认透明度正确）', () => {
    expect(getVoiceOverlayOpacity()).toBe(DEFAULT_VOICE_OVERLAY_OPACITY);
  });

  it('persists and emits opacity changes（持久化并广播透明度变化）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceOverlayOpacityChanges(listener);

    expect(setVoiceOverlayOpacity(74)).toBe(74);
    expect(storage['exomind:voiceOverlayOpacity']).toBe('74');
    expect(listener).toHaveBeenCalledWith(74);

    unsubscribe();
  });

  it('handles storage event updates（支持跨窗口 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceOverlayOpacityChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceOverlayOpacity',
      newValue: '88',
    }));

    expect(listener).toHaveBeenCalledWith(88);
    unsubscribe();
  });
});
