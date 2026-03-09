import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setVoiceShortcutAsrProvider } from '@/config/voice-shortcut-asr-provider';
import { VOLCANO_STORAGE_KEYS } from '@/lib/asr/volcano-config';

let voiceShortcutListener: ((event: { payload: string }) => void | Promise<void>) | null = null;

const emitMock = vi.fn();
const invokeMock = vi.fn();
const transcribeMock = vi.fn();
const convertWebmBlobToWavMock = vi.fn();
const writeClipboardMock = vi.fn();
const addEventMock = vi.fn();
const getUserMediaWithConstraintFallbackMock = vi.fn();
const subscribeHotkeyMock = vi.fn(() => () => {});

class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  private stopListeners: Array<() => void> = [];

  start(): void {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['voice-binary'], { type: 'audio/webm' }) });
  }

  addEventListener(name: string, listener: () => void): void {
    if (name === 'stop') {
      this.stopListeners.push(listener);
    }
  }

  stop(): void {
    if (this.state === 'inactive') {
      return;
    }
    this.state = 'inactive';
    const listeners = [...this.stopListeners];
    this.stopListeners = [];
    listeners.forEach((listener) => listener());
  }
}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, listener: (event: { payload: string }) => void | Promise<void>) => {
    if (eventName === 'voice-shortcut') {
      voiceShortcutListener = listener;
    }
    return () => {
      voiceShortcutListener = null;
    };
  }),
  emit: (...args: unknown[]) => {
    emitMock(...args);
    return Promise.resolve();
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  getVoiceShortcutHotkey: vi.fn(() => 'Ctrl+Space'),
  subscribeVoiceShortcutHotkeyChanges: (...args: unknown[]) => subscribeHotkeyMock(...args),
}));

vi.mock('@/lib/adapters/asr/moss-asr', () => ({
  MOSSASRAdapter: class {
    transcribe = (...args: unknown[]) => transcribeMock(...args);
  },
}));

vi.mock('@/lib/media/wav-audio', () => ({
  convertWebmBlobToWav: (...args: unknown[]) => convertWebmBlobToWavMock(...args),
}));

vi.mock('@/lib/media/microphone-capture', () => ({
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS: {},
  getUserMediaWithConstraintFallback: (...args: unknown[]) => getUserMediaWithConstraintFallbackMock(...args),
  createCompatibleMediaRecorder: () => ({
    recorder: new FakeMediaRecorder() as unknown as MediaRecorder,
    mimeType: 'audio/webm',
  }),
}));

vi.mock('@/lib/services/clipboard.service', () => ({
  getClipboardService: () => ({
    writeText: (...args: unknown[]) => writeClipboardMock(...args),
  }),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => ({
    addEvent: (...args: unknown[]) => addEventMock(...args),
  }),
}));

import { VoiceShortcutService } from '@/services/voice-shortcut.service';

async function emitVoiceShortcut(payload: 'start' | 'stop' | 'cancel'): Promise<void> {
  voiceShortcutListener?.({ payload });
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAsync(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('VoiceShortcutService（全局语音快捷键服务）', () => {
  beforeEach(() => {
    voiceShortcutListener = null;

    emitMock.mockReset();
    invokeMock.mockReset();
    transcribeMock.mockReset();
    convertWebmBlobToWavMock.mockReset();
    writeClipboardMock.mockReset();
    addEventMock.mockReset();
    getUserMediaWithConstraintFallbackMock.mockReset();
    subscribeHotkeyMock.mockClear();
    window.localStorage.removeItem('exomind:voiceShortcutAsrProvider');
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.appKey);
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.accessKey);
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.resourceId);

    getUserMediaWithConstraintFallbackMock.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });

    convertWebmBlobToWavMock.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    transcribeMock.mockResolvedValue({
      text: '连续识别文本',
      confidence: 0.99,
      lang: 'zh-CN',
    });

    writeClipboardMock.mockResolvedValue({ ok: true, title: 'ok' });
    addEventMock.mockResolvedValue(undefined);

    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_recognize') {
        return {
          text: '火山识别文本',
          confidence: 0.98,
          lang: 'zh-CN',
          duration: 1800,
        };
      }
      return null;
    });
  });

  it('supports multiple recognition rounds without decode failure（支持多轮识别）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = new VoiceShortcutService();
    await service.init();

    expect(voiceShortcutListener).not.toBeNull();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('start');
    await flushAsync();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(convertWebmBlobToWavMock).toHaveBeenCalledTimes(2);
    expect(transcribeMock).toHaveBeenCalledTimes(2);
    expect(writeClipboardMock).toHaveBeenCalledTimes(2);
    expect(addEventMock).toHaveBeenCalledTimes(2);

    const hasDecodeFailureLog = errorSpy.mock.calls.some((call) =>
      call.some((item) => String(item).includes('EncodingError') || String(item).includes('识别失败'))
    );
    expect(hasDecodeFailureLog).toBe(false);

    service.destroy();
    errorSpy.mockRestore();
  });

  it('ignores duplicate stop events in same round（同轮重复 stop 事件只处理一次）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');

    voiceShortcutListener?.({ payload: 'stop' });
    voiceShortcutListener?.({ payload: 'stop' });
    await flushAsync();

    expect(convertWebmBlobToWavMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock).toHaveBeenCalledTimes(1);

    service.destroy();
  });

  it('cancels active recording on cancel event without running ASR（收到 cancel 时立即取消录音且不走识别）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('cancel');
    await flushAsync();

    expect(convertWebmBlobToWavMock).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).not.toHaveBeenCalled();
    expect(addEventMock).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith('voice-overlay-state', expect.objectContaining({ state: 'idle' }));
    expect(invokeMock).toHaveBeenCalledWith('voice_overlay_hide');

    service.destroy();
  });

  it('uses volcano provider when selected in settings（切换到火山提供商后走 volcano_asr_recognize）', async () => {
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.bigasr.sauc.duration');

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith(
      'volcano_asr_recognize',
      expect.objectContaining({
        audioData: expect.any(Array),
        config: expect.objectContaining({
          appKey: 'test-app-key',
          accessKey: 'test-access-key',
          endpoint: 'bigmodel_async',
        }),
      })
    );
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'done',
        text: '火山识别文本',
        providerLabel: '火山',
        recognitionMs: expect.any(Number),
      })
    );

    service.destroy();
  });
});
