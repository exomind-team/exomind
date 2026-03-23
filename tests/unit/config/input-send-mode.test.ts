import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('input send mode（输入框发送方式）', () => {
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

  it('defaults to ctrl-enter-send when missing（未设置时默认 Ctrl+Enter 发送）', async () => {
    const module = await import('@/config/input-send-mode');
    expect(module.getInputSendMode()).toBe('ctrl-enter-send');
  });

  it('persists and emits custom event（保存并广播模式变更）', async () => {
    const module = await import('@/config/input-send-mode');
    const listener = vi.fn();
    const unsubscribe = module.subscribeInputSendModeChanges(listener);

    module.setInputSendMode('enter-send');

    expect(storage['exomind:inputSendMode']).toBe('enter-send');
    expect(listener).toHaveBeenCalledWith('enter-send');
    unsubscribe();
  });

  it('normalizes invalid values and supports storage sync（异常值归一化并支持 storage 同步）', async () => {
    const module = await import('@/config/input-send-mode');
    const listener = vi.fn();
    const unsubscribe = module.subscribeInputSendModeChanges(listener);

    storage['exomind:inputSendMode'] = 'unexpected';
    expect(module.getInputSendMode()).toBe('ctrl-enter-send');

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:inputSendMode',
      newValue: 'enter-send',
    }));

    expect(listener).toHaveBeenCalledWith('enter-send');
    unsubscribe();
  });
});
