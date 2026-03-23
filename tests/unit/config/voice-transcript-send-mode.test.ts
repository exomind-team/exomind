import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVoiceTranscriptSendMode,
  setVoiceTranscriptSendMode,
  subscribeVoiceTranscriptSendModeChanges,
} from '@/config/voice-transcript-send-mode';

describe('voice transcript send mode（语音转写发送模式）', () => {
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

  it('defaults to insert when missing（未设置时默认插入输入框）', () => {
    expect(getVoiceTranscriptSendMode()).toBe('insert');
  });

  it('persists and emits custom event（保存并广播模式变更）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceTranscriptSendModeChanges(listener);

    setVoiceTranscriptSendMode('direct-send');

    expect(storage['exomind:voiceTranscriptSendMode']).toBe('direct-send');
    expect(listener).toHaveBeenCalledWith('direct-send');
    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceTranscriptSendModeChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceTranscriptSendMode',
      newValue: 'direct-send',
    }));

    expect(listener).toHaveBeenCalledWith('direct-send');
    unsubscribe();
  });
});
