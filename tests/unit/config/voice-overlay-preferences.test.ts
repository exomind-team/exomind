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

  it('defaults diagnostics visibility to hidden（默认隐藏诊断信息）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    expect(typeof (module as any).getVoiceOverlayShowDiagnostics).toBe('function');
    expect((module as any).getVoiceOverlayShowDiagnostics()).toBe(false);
  });

  it('persists transcript line count（持久化实时文本行数）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    expect(typeof (module as any).setVoiceOverlayTranscriptLines).toBe('function');
    expect(typeof (module as any).getVoiceOverlayTranscriptLines).toBe('function');

    expect((module as any).setVoiceOverlayTranscriptLines(5)).toBe(5);
    expect(storage['exomind:voiceOverlayTranscriptLines']).toBe('5');
    expect((module as any).getVoiceOverlayTranscriptLines()).toBe(5);
  });

  it('persists overlay bottom offset（持久化悬浮窗底部间距）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    expect(typeof (module as any).setVoiceOverlayBottomOffset).toBe('function');
    expect(typeof (module as any).getVoiceOverlayBottomOffset).toBe('function');

    expect((module as any).setVoiceOverlayBottomOffset(64)).toBe(64);
    expect(storage['exomind:voiceOverlayBottomOffset']).toBe('64');
    expect((module as any).getVoiceOverlayBottomOffset()).toBe(64);
  });

  it('syncs diagnostics visibility through storage events（诊断信息开关支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = (module as any).subscribeVoiceOverlayShowDiagnosticsChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceOverlayShowDiagnostics',
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('syncs transcript lines through storage events（文本行数支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = (module as any).subscribeVoiceOverlayTranscriptLinesChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceOverlayTranscriptLines',
      newValue: '4',
    }));

    expect(listener).toHaveBeenCalledWith(4);
    unsubscribe();
  });

  it('syncs bottom offset through storage events（底部间距支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = (module as any).subscribeVoiceOverlayBottomOffsetChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceOverlayBottomOffset',
      newValue: '72',
    }));

    expect(listener).toHaveBeenCalledWith(72);
    unsubscribe();
  });
});
