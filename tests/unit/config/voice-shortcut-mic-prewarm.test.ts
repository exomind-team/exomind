import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVoiceShortcutMicPrewarmEnabled,
  setVoiceShortcutMicPrewarmEnabled,
  subscribeVoiceShortcutMicPrewarmChanges,
} from '@/config/voice-shortcut-mic-prewarm';

describe('voice shortcut mic prewarm（语音快捷键麦克风预启动）', () => {
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

  it('defaults to enabled when key is missing（未设置时默认开启）', () => {
    expect(getVoiceShortcutMicPrewarmEnabled()).toBe(true);
  });

  it('persists and emits custom event when toggled（切换时持久化并广播）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceShortcutMicPrewarmChanges(listener);

    setVoiceShortcutMicPrewarmEnabled(false);

    expect(storage['exomind:voiceShortcutMicPrewarmEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceShortcutMicPrewarmChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceShortcutMicPrewarmEnabled',
      newValue: 'false',
    }));

    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });
});
