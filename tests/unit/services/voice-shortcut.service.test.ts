import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_AUTO_RECORD_KEY } from '@/config/voice-auto-record';
import { setVoiceShortcutAsrProvider } from '@/config/voice-shortcut-asr-provider';
import { setVoiceShortcutMicPrewarmEnabled } from '@/config/voice-shortcut-mic-prewarm';
import { VOLCANO_STORAGE_KEYS } from '@/lib/asr/volcano-config';
import {
  getActiveInteractionContextService,
  resetActiveInteractionContextServiceForTests,
} from '@/lib/services/active-interaction-context.service';

const tauriEventListeners = new Map<string, (event: { payload: any }) => void | Promise<void>>();
let livePreviewOnUpdate: ((payload: { text: string; isFinal: boolean }) => void) | null = null;
let streamingOnChunk: ((chunk: Uint8Array) => Promise<void>) | null = null;
let streamingOnLevel: ((level: number) => void) | null = null;

const emitMock = vi.fn();
const invokeMock = vi.fn();
const transcribeMock = vi.fn();
const convertWebmBlobToWavMock = vi.fn();
const writeClipboardMock = vi.fn();
const addEventMock = vi.fn();
const publishVoiceTranscriptSignalMock = vi.fn();
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
const runtimeFlags = {
  developerModeEnabled: false,
  voiceShortcutSendMode: 'insert-only' as 'insert-only' | 'auto-enter-send',
};

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

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => runtimeFlags.developerModeEnabled,
  subscribeDeveloperModeChanges: () => () => {},
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

vi.mock('@/lib/services/voice-signal.service', () => ({
  publishVoiceTranscriptSignal: (...args: unknown[]) => publishVoiceTranscriptSignalMock(...args),
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: (...args: unknown[]) => addEventMock(...args),
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
      onLevel?: (level: number) => void;
    }];
    streamingOnChunk = options.onChunk;
    streamingOnLevel = options.onLevel ?? null;
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

async function flushPipeline(): Promise<void> {
  await flushAsync(30);
}

function expectLastVoiceStorageEvent(
  text: string,
  options?: {
    targetScope?: string;
    window?: {
      title?: string;
      processName?: string;
    };
    agentContext?: {
      agentId?: string;
      agentName?: string;
      sessionId?: string;
    };
  },
): void {
  expect(addEventMock).toHaveBeenCalled();
  const lastCall = addEventMock.mock.calls.at(-1);
  expect(lastCall).toBeDefined();
  const [event] = lastCall ?? [];
  expect(event).toEqual(expect.objectContaining({
    content: text,
    type: 'voice',
    metadata: expect.objectContaining({
      inputSource: 'voice',
      inputMethod: 'recognition',
      voiceShortcut: expect.objectContaining({
        text,
        captureSource: 'global-shortcut',
        ...(options?.targetScope ? { targetScope: options.targetScope } : {}),
        ...(options?.window ? { window: options.window } : {}),
        ...(options?.agentContext ? { agentContext: options.agentContext } : {}),
      }),
    }),
  }));
}

describe('VoiceShortcutService（全局语音快捷键服务）', () => {
  beforeEach(() => {
    vi.useRealTimers();
    tauriEventListeners.clear();
    livePreviewOnUpdate = null;
    streamingOnChunk = null;
    streamingOnLevel = null;

    emitMock.mockReset();
    invokeMock.mockReset();
    transcribeMock.mockReset();
    convertWebmBlobToWavMock.mockReset();
    writeClipboardMock.mockReset();
    addEventMock.mockReset();
    publishVoiceTranscriptSignalMock.mockReset();
    publishVoiceTranscriptSignalMock.mockResolvedValue(undefined);
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
    runtimeFlags.developerModeEnabled = false;
    runtimeFlags.voiceShortcutSendMode = 'insert-only';
    resetActiveInteractionContextServiceForTests();

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
    window.localStorage.removeItem('exomind:voiceShortcutMicPrewarmEnabled');
    window.localStorage.removeItem('exomind:voiceShortcutSendMode');
    window.localStorage.removeItem(VOICE_AUTO_RECORD_KEY);
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
    setVoiceShortcutMicPrewarmEnabled(true);

    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'foreground_window_get') {
        return {
          title: 'Cursor - ExoMind',
          processName: 'Cursor.exe',
        };
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
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

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
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

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

  it('does not write empty recognition text to event log（空识别结果不写事件日志）', async () => {
    transcribeMock.mockResolvedValue({
      text: '   ',
      confidence: 0.4,
      lang: 'zh-CN',
    });

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(addEventMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'error',
      }),
    );

    service.destroy();
  });

  it('appends voice storage event by default（默认自动记录语音输入）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

    expectLastVoiceStorageEvent('连续识别文本');

    service.destroy();
  });

  it('skips voice storage event when auto-record is disabled（关闭自动记录后不写入事件日志）', async () => {
    window.localStorage.setItem(VOICE_AUTO_RECORD_KEY, '0');

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

    expect(writeClipboardMock).toHaveBeenCalledWith('连续识别文本');
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalled();
    expect(addEventMock).not.toHaveBeenCalled();

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
        traceStartedAtMs: expect.any(Number),
        inputReadyMs: expect.any(Number),
        inputWarmHit: expect.any(Boolean),
        firstTextMs: expect.any(Number),
        debugTraceId: expect.any(String),
        isLivePreview: true,
      })
    );

    await emitVoiceShortcut('start');
    await flushAsync();
    expect(livePreviewStopMock).toHaveBeenCalledTimes(1);

    service.destroy();
  });

  it('does not reset duration to zero on live preview updates（实时文本刷新时不重置时长）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    emitMock.mockClear();

    livePreviewOnUpdate?.({ text: '新的实时文本', isFinal: false });
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.not.objectContaining({
        duration: 0,
      }),
    );

    service.destroy();
  });

  it('shows arming overlay before microphone startup resolves（麦克风初始化未完成前先显示启动态）', async () => {
    getUserMediaWithConstraintFallbackMock.mockImplementation(
      () => new Promise(() => {})
    );

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();

    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'arming',
        duration: 0,
      })
    );

    service.destroy();
  });

  it('does not prewarm microphone when prewarm setting is disabled（关闭预启动后不后台预热麦克风）', async () => {
    setVoiceShortcutMicPrewarmEnabled(false);

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).not.toHaveBeenCalled();

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
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'arming',
        text: '正在唤起语音输入…',
      }),
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
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'volcano_asr_stream_start')
    ).toHaveLength(1);

    service.destroy();
  });

  it('replenishes standby volcano session immediately after consuming a warm one（消费 warm session 后立即补一个 standby）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const sessionIds = ['warm-session-1', 'standby-session-2', 'standby-session-3'];
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'foreground_window_get') {
        return {
          title: 'Cursor - ExoMind',
          processName: 'Cursor.exe',
        };
      }
      if (command === 'volcano_asr_stream_start') {
        return sessionIds.shift() ?? 'fallback-session';
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

    invokeMock.mockClear();
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'volcano_asr_stream_start')
    ).toHaveLength(1);

    service.destroy();
  });

  it('rewarms resources when window regains focus（切回前台时重新预热资源）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    let sessionCounter = 0;
    let sessionAlive = true;
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        sessionCounter += 1;
        return `focus-session-${sessionCounter}`;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return sessionAlive;
      }
      if (command === 'volcano_asr_stream_cancel' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();
    const initialSessionCount = sessionCounter;
    expect(initialSessionCount).toBeGreaterThanOrEqual(1);

    sessionAlive = false;
    window.dispatchEvent(new Event('focus'));
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_session_exists', {
      sessionId: expect.stringMatching(/^focus-session-/),
    });
    expect(sessionCounter).toBeGreaterThan(initialSessionCount);

    service.destroy();
  });

  it('rewarms stale volcano session in background while idle（空闲时后台自动补热失效 session）', async () => {
    vi.useFakeTimers();
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    let sessionCounter = 0;
    let sessionAlive = true;
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        sessionCounter += 1;
        return `idle-session-${sessionCounter}`;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return sessionAlive;
      }
      if (command === 'volcano_asr_stream_cancel' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    const initialSessionCount = sessionCounter;
    expect(initialSessionCount).toBeGreaterThanOrEqual(1);

    sessionAlive = false;
    await vi.advanceTimersByTimeAsync(15000);
    await flushAsync();

    expect(sessionCounter).toBeGreaterThan(initialSessionCount);

    service.destroy();
    vi.useRealTimers();
  });

  it('suppresses voice debug logs when developer mode is disabled（关闭开发者模式时不输出语音调试日志）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const service = new VoiceShortcutService();
    await service.init();
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    service.destroy();
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('emits voice debug logs when developer mode is enabled（开启开发者模式时输出语音调试日志）', async () => {
    runtimeFlags.developerModeEnabled = true;
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const service = new VoiceShortcutService();
    await service.init();
    await emitVoiceShortcut('start');
    await flushAsync();

    expect(
      debugSpy.mock.calls.some((call) => call.map(String).join(' ').includes('[trace voice-'))
    ).toBe(true);

    service.destroy();
    debugSpy.mockRestore();
  });

  it('rotates standby session before the idle window expires（待命会话在空闲窗口到期前主动轮换）', async () => {
    vi.useFakeTimers();
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    let sessionCounter = 0;
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        sessionCounter += 1;
        return `rotate-session-${sessionCounter}`;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
      }
      if (command === 'volcano_asr_stream_cancel' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    const initialSessionCount = sessionCounter;
    expect(initialSessionCount).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(7000);
    await flushAsync();

    expect(sessionCounter).toBeGreaterThan(initialSessionCount);

    service.destroy();
    vi.useRealTimers();
  });

  it('replenishes standby session immediately when warm session closes remotely（standby 被远端关闭后立即补位）', async () => {
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const startedSessions: string[] = [];
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        const nextSessionId = `warm-session-${startedSessions.length + 1}`;
        startedSessions.push(nextSessionId);
        return nextSessionId;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
      }
      if (command === 'volcano_asr_stream_cancel' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();

    const initialSessionCount = startedSessions.length;
    expect(initialSessionCount).toBeGreaterThanOrEqual(1);
    const activeWarmSessionId = startedSessions.at(-1);

    await emitVolcanoStreamEvent({
      sessionId: activeWarmSessionId,
      errorMessage: 'WebSocket 被服务器关闭',
    });
    await flushAsync();

    expect(startedSessions.length).toBeGreaterThan(initialSessionCount);

    service.destroy();
  });

  it('logs standby lifecycle timestamps when warm session closes remotely（standby 关闭时记录创建/关闭/存活时长）', async () => {
    runtimeFlags.developerModeEnabled = true;
    permissionsQueryMock.mockResolvedValue({ state: 'granted' });
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let now = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    const startedSessions: string[] = [];
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        const nextSessionId = `warm-session-${startedSessions.length + 1}`;
        startedSessions.push(nextSessionId);
        return nextSessionId;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
      }
      if (command === 'volcano_asr_stream_cancel' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await flushAsync();
    const activeWarmSessionId = startedSessions.at(-1);

    now = 61000;
    await emitVolcanoStreamEvent({
      sessionId: activeWarmSessionId,
      errorMessage: 'WebSocket 被服务器关闭',
    });
    await flushAsync();

    const loggedMessages = debugSpy.mock.calls.map((call) => call.map(String).join(' '));
    expect(
      loggedMessages.some((message) =>
        message.includes('standby prepared')
        && message.includes(`session=${activeWarmSessionId}`)
        && message.includes('createdAt=1000')
      )
    ).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes('standby closed')
        && message.includes(`session=${activeWarmSessionId}`)
        && message.includes('createdAt=1000')
        && message.includes('closedAt=61000')
        && message.includes('lifetimeMs=60000')
        && message.includes('reason=WebSocket 被服务器关闭')
      )
    ).toBe(true);

    service.destroy();
    nowSpy.mockRestore();
    debugSpy.mockRestore();
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

    const initialSessionCount = startedSessions.length;
    expect(initialSessionCount).toBeGreaterThanOrEqual(1);

    invokeMock.mockClear();
    getUserMediaWithConstraintFallbackMock.mockClear();

    await emitVoiceShortcut('start');
    await flushAsync();

    expect(getUserMediaWithConstraintFallbackMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_session_exists', {
      sessionId: expect.stringMatching(/^warm-session-/),
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'volcano_asr_stream_start',
      expect.objectContaining({
        config: expect.objectContaining({
          appKey: 'test-app-key',
        }),
      }),
    );
    expect(startedSessions.length).toBeGreaterThan(initialSessionCount);

    service.destroy();
  });

  it('uses volcano native streaming when selected in settings（切换到火山后走原生流式链路）', async () => {
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');
    const sessionIds = ['warm-session-bootstrap', 'stream-session-1', 'standby-session-2'];
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
        return sessionIds.shift() ?? 'fallback-session';
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
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
    await flushAsync();
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
    await flushPipeline();
    const pushCall = invokeMock.mock.calls.find(([command]) => command === 'volcano_asr_stream_push');
    const activeSessionId = pushCall?.[1]?.sessionId;
    expect(activeSessionId).toEqual(expect.any(String));
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_push', {
      sessionId: activeSessionId,
      audioData: [1, 2, 3, 4],
    });

    await emitVolcanoStreamEvent({
      sessionId: activeSessionId,
      text: '火山实时结果',
      isFinal: false,
      isDefinite: false,
    });
    await flushPipeline();
    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recording',
        text: '火山实时结果',
        isLivePreview: true,
        traceStartedAtMs: expect.any(Number),
        inputReadyMs: expect.any(Number),
        sessionReadyMs: expect.any(Number),
        inputWarmHit: expect.any(Boolean),
        sessionWarmHit: expect.any(Boolean),
        sessionWarmReason: expect.any(String),
        providerLabel: '火山 2.0 小时版 · 双向流式优化版（推荐）',
      })
    );

    await emitVoiceShortcut('start');
    await flushPipeline();

    await emitVolcanoStreamEvent({
      sessionId: activeSessionId,
      text: '收口阶段实时结果',
      isFinal: false,
      isDefinite: true,
    });
    await flushPipeline();
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
    await flushPipeline();

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(convertWebmBlobToWavMock).not.toHaveBeenCalled();
    expect(streamingCaptureStopMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('volcano_asr_stream_finish', {
      sessionId: activeSessionId,
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
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '火山流式最终文本' }),
      expect.objectContaining({
        source: 'tauri:voice-shortcut',
        captureSource: 'global-shortcut',
        targetScope: 'unknown',
      }),
    );
    // 语音输入始终写入 EventLog（前端直写）
    expect(addEventMock).toHaveBeenCalled();

    service.destroy();
  });

  it('emits overlay audio level from volcano capture（火山采集会把音量传给悬浮窗）', async () => {
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        return 'stream-session-level';
      }
      if (command === 'volcano_asr_stream_push' || command === 'voice_recording_set_active') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();
    await emitVoiceShortcut('start');
    await flushAsync();

    emitMock.mockClear();
    streamingOnLevel?.(0.72);
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recording',
        audioLevel: 0.72,
      }),
    );

    service.destroy();
  });

  it('normalizes duplicated volcano transcript before finishing（火山重复文本在收口前会归一）', async () => {
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
        return 'stream-session-dedup';
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
    await flushPipeline();

    await emitVoiceShortcut('start');
    await flushPipeline();

    resolveFinish?.({
      text: '火山实时结果火山实时结果',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1800,
    });
    await flushPipeline();

    expect(writeClipboardMock).toHaveBeenCalledWith('火山实时结果');
    expectLastVoiceStorageEvent('火山实时结果');

    service.destroy();
  });

  it('attaches active agent context to voice event metadata（在 Agent 对话场景附加活跃上下文）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    getActiveInteractionContextService().setContext({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-xyz',
      },
    }, 'test-owner');

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('stop');
    await flushPipeline();

    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '连续识别文本' }),
      expect.objectContaining({
        source: 'tauri:voice-shortcut',
        captureSource: 'global-shortcut',
        targetScope: 'agent-chat',
        window: {
          title: 'Cursor - ExoMind',
          processName: 'Cursor.exe',
        },
        agentContext: {
          agentId: 'codex',
          agentName: 'Codex',
          sessionId: 'session-xyz',
        },
      }),
    );
    expectLastVoiceStorageEvent('连续识别文本', {
      targetScope: 'agent-chat',
      window: {
        title: 'Cursor - ExoMind',
        processName: 'Cursor.exe',
      },
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-xyz',
      },
    });

    service.destroy();
  });

  it('freezes foreground window context at recording start（录音开始时冻结窗口上下文，避免识别结束时漂移）', async () => {
    let foregroundReadCount = 0;
    transcribeMock.mockResolvedValue({
      text: '冻结窗口测试',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1000,
    });
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'foreground_window_get') {
        foregroundReadCount += 1;
        return foregroundReadCount === 1
          ? { title: 'Window A', processName: 'AppA.exe' }
          : { title: 'Window B', processName: 'AppB.exe' };
      }
      if (command === 'voice_recording_set_active' || command === 'simulate_paste') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('stop');
    await flushPipeline();

    expect(foregroundReadCount).toBe(1);
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '冻结窗口测试' }),
      expect.objectContaining({
        targetScope: 'external-window',
        window: {
          title: 'Window A',
          processName: 'AppA.exe',
        },
      }),
    );
    expectLastVoiceStorageEvent('冻结窗口测试', {
      targetScope: 'external-window',
      window: {
        title: 'Window A',
        processName: 'AppA.exe',
      },
    });

    service.destroy();
  });

  it('still appends voice storage event when signal publish fails（信号发布失败时仍写入事件日志）', async () => {
    transcribeMock.mockResolvedValue({
      text: 'fallback 测试',
      confidence: 0.95,
      lang: 'zh-CN',
      duration: 500,
    });
    writeClipboardMock.mockResolvedValue({ ok: true, title: 'ok' });
    addEventMock.mockResolvedValue(undefined);
    publishVoiceTranscriptSignalMock.mockRejectedValue(new Error('RT unavailable'));
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') return payload?.shortcut ?? 'Alt+Q';
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('stop');
    await flushPipeline();

    expectLastVoiceStorageEvent('fallback 测试');

    service.destroy();
  });

  it('handles double failure gracefully when both signal and storage append fail（信号和事件日志双重失败时不崩溃）', async () => {
    transcribeMock.mockResolvedValue({
      text: '双重失败测试',
      confidence: 0.95,
      lang: 'zh-CN',
      duration: 500,
    });
    writeClipboardMock.mockResolvedValue({ ok: true, title: 'ok' });
    publishVoiceTranscriptSignalMock.mockRejectedValue(new Error('RT unavailable'));
    addEventMock.mockRejectedValue(new Error('storage full'));
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') return payload?.shortcut ?? 'Alt+Q';
      return null;
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('stop');
    await flushPipeline();

    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalled();
    expect(addEventMock).toHaveBeenCalled();

    service.destroy();
    errorSpy.mockRestore();
  });

  it('ignores stale foreground window result from previous round（上一轮迟到的窗口结果不会覆盖新一轮）', async () => {
    let resolveFirstForeground: ((value: { title: string; processName: string }) => void) | null = null;
    let secondForegroundResolved = false;
    transcribeMock.mockResolvedValue({
      text: '第二轮文本',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1000,
    });

    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'foreground_window_get') {
        if (!resolveFirstForeground) {
          return await new Promise((resolve) => {
            resolveFirstForeground = resolve;
          });
        }
        secondForegroundResolved = true;
        return { title: 'Window B', processName: 'AppB.exe' };
      }
      if (command === 'voice_recording_set_active' || command === 'simulate_paste') {
        return null;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();

    await emitVoiceShortcut('start');
    await emitVoiceShortcut('cancel');
    await flushPipeline();

    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('stop');
    await flushPipeline();

    expect(secondForegroundResolved).toBe(true);
    expect(publishVoiceTranscriptSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '第二轮文本' }),
      expect.objectContaining({
        targetScope: 'external-window',
        window: {
          title: 'Window B',
          processName: 'AppB.exe',
        },
      }),
    );

    resolveFirstForeground?.({ title: 'Window A', processName: 'AppA.exe' });
    await flushPipeline();

    const lastPublishCall = publishVoiceTranscriptSignalMock.mock.calls.at(-1);
    expect(lastPublishCall?.[1]).toEqual(expect.objectContaining({
      window: {
        title: 'Window B',
        processName: 'AppB.exe',
      },
    }));

    service.destroy();
  });

  it('ignores late volcano chunks after stop begins（停止录音后忽略迟到 chunk，避免 finish 后继续 push）', async () => {
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
        return 'stream-session-late';
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
    await flushAsync();

    invokeMock.mockClear();
    const stopPromise = emitVoiceShortcut('start');
    await flushAsync();

    await streamingOnChunk?.(new Uint8Array([7, 7, 7, 7]));
    await flushAsync();

    expect(invokeMock).not.toHaveBeenCalledWith('volcano_asr_stream_push', {
      sessionId: 'stream-session-late',
      audioData: [7, 7, 7, 7],
    });

    resolveFinish?.({
      text: '停止后的最终文本',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1200,
    });
    await stopPromise;
    await flushAsync();

    service.destroy();
  });

  it('records volcano microphone and session timings independently（火山麦克风与会话耗时独立埋点）', async () => {
    setVoiceShortcutMicPrewarmEnabled(false);
    setVoiceShortcutAsrProvider('volcano');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.appKey, 'test-app-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.accessKey, 'test-access-key');
    window.localStorage.setItem(VOLCANO_STORAGE_KEYS.resourceId, 'volc.seedasr.sauc.duration');

    let resolveStream: ((value: {
      getTracks: () => Array<{ stop: ReturnType<typeof vi.fn>; readyState: 'live' }>;
    }) => void) | null = null;
    let resolveSession: ((value: string) => void) | null = null;
    let now = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    getUserMediaWithConstraintFallbackMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        })
    );
    invokeMock.mockImplementation(async (command: string, payload?: { shortcut?: string }) => {
      if (command === 'voice_shortcut_set') {
        return payload?.shortcut ?? 'Alt+Q';
      }
      if (command === 'volcano_asr_stream_start') {
        return await new Promise<string>((resolve) => {
          resolveSession = resolve;
        });
      }
      if (command === 'volcano_asr_stream_push' || command === 'voice_recording_set_active') {
        return null;
      }
      if (command === 'volcano_asr_stream_session_exists') {
        return true;
      }
      return null;
    });

    const service = new VoiceShortcutService();
    await service.init();

    const startPromise = emitVoiceShortcut('start');
    await flushAsync();

    now = 1210;
    resolveSession?.('stream-session-timing');
    await flushAsync();

    now = 1680;
    resolveStream?.({
      getTracks: () => [{ stop: vi.fn(), readyState: 'live' }],
    });
    await startPromise;
    await flushAsync();

    expect(emitMock).toHaveBeenCalledWith(
      'voice-overlay-state',
      expect.objectContaining({
        state: 'recording',
        sessionReadyMs: 210,
        sessionWarmReason: 'missing',
        inputReadyMs: 680,
        activationMs: 680,
      })
    );

    service.destroy();
    nowSpy.mockRestore();
  });

  it('keeps paste-only behavior by default for external targets（默认仅插入文本，不自动回车）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    invokeMock.mockClear();
    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();

    expect(invokeMock).toHaveBeenCalledWith('simulate_paste');
    expect(invokeMock).not.toHaveBeenCalledWith('simulate_enter');

    service.destroy();
  });

  it('auto-sends after paste when external mode is auto-enter-send（外部输入开启后自动补回车发送）', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('exomind:voiceShortcutSendMode', 'auto-enter-send');

    const service = new VoiceShortcutService();
    await service.init();

    invokeMock.mockClear();
    await emitVoiceShortcut('start');
    await flushPipeline();
    await emitVoiceShortcut('start');
    await flushPipeline();
    await vi.advanceTimersByTimeAsync(120);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith('simulate_paste');
    expect(invokeMock).toHaveBeenCalledWith('simulate_enter');

    service.destroy();
    vi.useRealTimers();
  });

  it('syncs overlay bottom offset changes to native window（悬浮窗底部间距变化会同步到原生窗口）', async () => {
    const service = new VoiceShortcutService();
    await service.init();

    invokeMock.mockClear();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:voiceOverlayBottomOffset',
      newValue: '72',
    }));
    await flushAsync();

    expect(invokeMock).toHaveBeenCalledWith('voice_overlay_set_bottom_offset', { offset: 72 });

    service.destroy();
  });
});
