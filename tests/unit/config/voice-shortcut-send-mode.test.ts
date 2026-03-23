import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('voice shortcut send mode（快捷语音发送模式）', () => {
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

  it('defaults to insert-only when missing（未设置时默认仅插入文本）', async () => {
    const module = await import('@/config/voice-shortcut-send-mode');
    expect(typeof module.getVoiceShortcutSendMode).toBe('function');
    expect(module.getVoiceShortcutSendMode()).toBe('insert-only');
  });

  it('persists and emits custom event（保存并广播模式变更）', async () => {
    const module = await import('@/config/voice-shortcut-send-mode');
    expect(typeof module.setVoiceShortcutSendMode).toBe('function');
    expect(typeof module.subscribeVoiceShortcutSendModeChanges).toBe('function');

    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceShortcutSendModeChanges(listener);

    module.setVoiceShortcutSendMode('auto-enter-send');

    expect(storage['exomind:voiceShortcutSendMode']).toBe('auto-enter-send');
    expect(listener).toHaveBeenCalledWith('auto-enter-send');
    unsubscribe();
  });

  it('normalizes invalid values and supports storage sync（异常值归一化并支持 storage 同步）', async () => {
    const module = await import('@/config/voice-shortcut-send-mode');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceShortcutSendModeChanges(listener);

    storage['exomind:voiceShortcutSendMode'] = 'unexpected';
    expect(module.getVoiceShortcutSendMode()).toBe('insert-only');

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceShortcutSendMode',
      newValue: 'auto-enter-send',
    }));

    expect(listener).toHaveBeenCalledWith('auto-enter-send');
    unsubscribe();
  });
});
