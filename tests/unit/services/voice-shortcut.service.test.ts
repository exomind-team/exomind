import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setVoiceShortcutAsrProvider } from '@/config/voice-shortcut-asr-provider';
import { VOLCANO_STORAGE_KEYS } from '@/lib/asr/volcano-config';

const tauriEventListeners = new Map<string, (event: { payload: any }) => void | Promise<void>>();
let livePreviewOnUpdate: ((payload: { text: string; isFinal: boolean }) => void) | null = null;
let streamingOnChunk: ((chunk: Uint8Array) => Promise<void>) | null = null;

const emitMock = vi.fn();
const invokeMock = vi.fn();
const transcribeMock = vi.fn();
const convertWebmBlobToWavMock = vi.fn();
const writeClipboardMock = vi.fn();
const addEventMock = vi.fn();
const getUserMediaWithConstraintFallbackMock = vi.fn();
const subscribeHotkeyMock = vi.fn(() => () => {});
const livePreviewIsAvailableMock = vi.fn(() => true);
const livePreviewCreateSessionMock = vi.fn();
const livePreviewStartMock = vi.fn();
const livePreviewStopMock = vi.fn();
const livePreviewAbortMock = vi.fn();
const streamingCaptureCreateMock = vi.fn();
const streamingCaptureStartMock = vi.fn();
const streamingCaptureStopMock = vi.fn(async () => new Uint8Array([9, 8, 7, 6]));
const streamingCaptureCancelMock = vi.fn();
const permissionsQueryMock = vi.fn();
const nativeGetUserMediaMock = vi.fn();

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
  listen: vi.fn(async (eventName: string, listener: (event: { payload: any }) => void | Promise<void>) => {
    tauriEventListeners.set(eventName, listener);
    return () => {
      tauriEventListeners.delete(eventName);
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

vi.mock('@/lib/asr/live-preview', () => ({
  createDefaultVoiceLivePreviewSource: () => ({
    isAvailable: (...args: unknown[]) => livePreviewIsAvailableMock(...args),
    createSession: (...args: unknown[]) => {
      const [options] = args as [{
        onUpdate: (payload: { text: string; isFinal: boolean }) => void;
      }];
      livePreviewOnUpdate = options.onUpdate;
      livePreviewCreateSessionMock(...args);
      return {
        start: () => livePreviewStartMock(),
        stop: () => livePreviewStopMock(),
        abort: () => livePreviewAbortMock(),
      };
    },
  }),
}));

vi.mock('@/lib/asr/volcano-streaming-capture', () => ({
  createVolcanoStreamingCapture: (...args: unknown[]) => {
    const [options] = args as [{
      onChunk: (chunk: Uint8Array) => Promise<void>;
    }];
    streamingOnChunk = options.onChunk;
    streamingCaptureCreateMock(...args);
    return {
      start: () => streamingCaptureStartMock(),
      stop: () => streamingCaptureStopMock(),
      cancel: () => streamingCaptureCancelMock(),
    };
  },
}));

import { VoiceShortcutService } from '@/services/voice-shortcut.service';

async function emitVoiceShortcut(payload: 'start' | 'stop' | 'cancel'): Promise<void> {
  await tauriEventListeners.get('voice-shortcut')?.({ payload });
  await Promise.resolve();
  await Promise.resolve();
}

async function emitVolcanoStreamEvent(payload: Record<string, unknown>): Promise<void> {
  await tauriEventListeners.get('volcano-asr-stream-event')?.({ payload });
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
    tauriEventListeners.clear();
    livePreviewOnUpdate = null;
    streamingOnChunk = null;

    emitMock.mockReset();
    invokeMock.mockReset();
    transcribeMock.mockReset();
    convertWebmBlobToWavMock.mockReset();
    writeClipboardMock.mockReset();
    addEventMock.mockReset();
    getUserMediaWithConstraintFallbackMock.mockReset();
    subscribeHotkeyMock.mockClear();
    livePreviewIsAvailableMock.mockReset();
    livePreviewIsAvailableMock.mockReturnValue(true);
    livePreviewCreateSessionMock.mockReset();
    livePreviewStartMock.mockReset();
    livePreviewStopMock.mockReset();
    livePreviewAbortMock.mockReset();
    streamingCaptureCreateMock.mockReset();
    streamingCaptureStartMock.mockReset();
    streamingCaptureStopMock.mockReset();
    streamingCaptureStopMock.mockImplementation(async () => new Uint8Array([9, 8, 7, 6]));
    streamingCaptureCancelMock.mockReset();
    permissionsQueryMock.mockReset();
    permissionsQueryMock.mockResolvedValue({ state: 'prompt' });
    nativeGetUserMediaMock.mockReset();

    Object.defineProperty(window.navigator, 'permissions', {
      configurable: true,
      value: {
        query: permissionsQueryMock,
      },
    });
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: nativeGetUserMediaMock,
      },
    });

    window.localStorage.removeItem('exomind:voiceShortcutAsrProvider');
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.appKey);
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.accessKey);
    window.localStorage.removeItem(VOLCANO_STORAGE_KEYS.resourceId);

    getUserMediaWithConstraintFallbackMock.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn(), readyState: 'live' }],
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

    expect(tauriEventListeners.get('voice-shortcut')).toBeTruthy();

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

  it('keeps overlay visible when restarting immediately after done（完成后立刻重开时不应先隐藏悬浮窗）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('start');
    await flushAsync();

    emitMock.mockClear();
    invokeMock.mockClear();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(invokeMock).not.toHaveBeenCalledWith('voice_overlay_hide');
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: expect.stringMatching(/arming|recording/),
      }),
    );

    service.destroy();
  });

  it('ignores duplicate stop events in same round（同轮重复 stop 事件只处理一次）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');

    await tauriEventListeners.get('voice-shortcut')?.({ payload: 'stop' });
    await tauriEventListeners.get('voice-shortcut')?.({ payload: 'stop' });
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

  it('emits full live preview text during recording（录音时发出完整实时预览文本）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    const longText = Array.from({ length: 120 }, (_, index) => String(index % 10)).join('');
    livePreviewOnUpdate?.({ text: longText, isFinal: false });
    await flushAsync();

    expect(livePreviewCreateSessionMock).toHaveBeenCalledTimes(1);
    expect(livePreviewStartMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recording',
        text: longText,
        isLivePreview: true,
      })
    );

    await emitVoiceShortcut('start');
    await flushAsync();
    expect(livePreviewStopMock).toHaveBeenCalledTimes(1);

    service.destroy();
  });

  it('shows arming overlay before microphone startup resolves（麦克风初始化未完成前先显示启动态）', async () => {
    getUserMediaWithConstraintFallbackMock.mockImplementation(
      () => new Promise(() => {})
    );

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'arming',
        duration: 0,
      })
    );

    service.destroy();
  });

  it('prewarms granted microphone and reuses it on start（权限已授予时预热并复用麦克风）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).toHaveBeenCalledTimes(1);

    getUserMediaWithConstraintFallbackMock.mockClear();
    emitMock.mockClear();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({ state: 'arming' }),
    );

    service.destroy();
  });

  it('prewarms volcano session and reuses it on first start（火山模式预建 session 并在首按复用）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const sessionIds = ['warm-session-1', 'warm-session-2'];
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        return sessionIds.shift() ?? 'warm-session-fallback';
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
      }
      if (command === 'volcano_asr_stream_push' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith(
      'volcano_asr_stream_start',
      expect.objectContaining({
        config: expect.objectContaining({
          appKey: 'test-app-key',
        }),
      }),
    );

    invokeMock.mockClear();
    getUserMediaWithConstraintFallbackMock.mockClear();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      'volcano_asr_stream_start',
      expect.anything(),
    );

    service.destroy();
  });

  it('recreates missing warmed volcano session before first start（warm session 已失效时首按自动重建）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const startedSessions: string[] = [];
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string; sessionId?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        const nextSessionId = `warm-session-${startedSessions.length + 1}`;
        startedSessions.push(nextSessionId);
        return nextSessionId;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return false;
      }
      if (command === 'volcano_asr_stream_push' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    expect(startedSessions).toEqual(['warm-session-1']);

    invokeMock.mockClear();
    getUserMediaWithConstraintFallbackMock.mockClear();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_session_exists', {
      sessionId: 'warm-session-1',
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'volcano_asr_stream_start',
      expect.objectContaining({
        config: expect.objectContaining({
          appKey: 'test-app-key',
        }),
      }),
    );

    service.destroy();
  });

  it('uses volcano native streaming when selected in settings（切换到火山后走原生流式链路）', async () => {
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');
    let resolveFinish: ((value: {
      text: string;
      confidence: number;
      lang: string;
      duration: number;
    }) => void) | null = null;

    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        return 'stream-session-1';
      }
      if (command === 'volcano_asr_stream_push') {
        return null;
      }
      if (command === 'volcano_asr_stream_finish') {
        return await new Promise((resolve) => {
          resolveFinish = resolve;
        });
      }
      if (command === 'voice_recording_set_active' || command === 'simulate_paste') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    expect(livePreviewCreateSessionMock).not.toHaveBeenCalled();
    expect(streamingCaptureCreateMock).toHaveBeenCalledTimes(1);
    expect(streamingCaptureStartMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      'volcano_asr_stream_start',
      expect.objectContaining({
        config: expect.objectContaining({
          appKey: 'test-app-key',
          accessKey: 'test-access-key',
          endpoint: 'bigmodel_async',
          request: expect.objectContaining({
            enable_nonstream: true,
            show_utterances: true,
          }),
        }),
      })
    );

    await streamingOnChunk?.(new Uint8Array([1, 2, 3, 4]));
    await flushAsync();
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_push', {
      sessionId: 'stream-session-1',
      audioData: [1, 2, 3, 4],
    });

    await emitVolcanoStreamEvent({
      sessionId: 'stream-session-1',
      text: '火山实时结果',
      isFinal: false,
      isDefinite: false,
    });
    await flushAsync();
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recording',
        text: '火山实时结果',
        isLivePreview: true,
        providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
      })
    );

    await emitVoiceShortcut('start');
    await flushAsync();

    await emitVolcanoStreamEvent({
      sessionId: 'stream-session-1',
      text: '收口阶段实时结果',
      isFinal: false,
      isDefinite: true,
    });
    await flushAsync();
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recognizing',
        text: '收口阶段实时结果',
        isLivePreview: true,
      })
    );

    resolveFinish?.({
      text: '火山流式最终文本',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1800,
    });
    await flushAsync();

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(convertWebmBlobToWavMock).not.toHaveBeenCalled();
    expect(streamingCaptureStopMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_finish', {
      sessionId: 'stream-session-1',
      audioData: [9, 8, 7, 6],
    });
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'done',
        text: '火山流式最终文本',
        providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
        recognitionMs: expect.any(Number),
      })
    );
    expect(writeClipboardMock).toHaveBeenCalledWith('火山流式最终文本');
    expect(addEventMock).toHaveBeenCalledWith('火山流式最终文本', new Set(['voice']));

    service.destroy();
  });
});
