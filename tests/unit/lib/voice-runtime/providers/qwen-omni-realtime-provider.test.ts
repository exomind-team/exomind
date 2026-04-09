import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE_RUNTIME_OMNI_PROVIDER } from '@/config/voice-runtime-settings';

const tauriEventListeners = new Map<string, Set<(event: { payload: unknown }) => void | Promise<void>>>();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, listener: (event: { payload: unknown }) => void | Promise<void>) => {
    const listeners = tauriEventListeners.get(eventName) ?? new Set();
    listeners.add(listener);
    tauriEventListeners.set(eventName, listeners);
    return () => {
      const current = tauriEventListeners.get(eventName);
      current?.delete(listener);
      if (current && current.size === 0) {
        tauriEventListeners.delete(eventName);
      }
    };
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  OMNI_REALTIME_EVENT_NAME,
  QwenOmniRealtimeProvider,
} from '@/lib/voice-runtime/providers/qwen-omni-realtime-provider';

async function emitOmniRealtimeEvent(payload: Record<string, unknown>): Promise<void> {
  const listeners = Array.from(tauriEventListeners.get(OMNI_REALTIME_EVENT_NAME) ?? []);
  await Promise.all(listeners.map((listener) => listener({ payload })));
  await Promise.resolve();
}

async function startProviderSession(
  provider: QwenOmniRealtimeProvider,
  sessionId = 'omni-session-1',
): Promise<string> {
  const startPromise = provider.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await emitOmniRealtimeEvent({
    sessionId,
    eventType: 'SessionStarted',
    model: `${'q'}wen3.5-omni-plus-realtime`,
    payload: { session_id: sessionId },
    capturedAt: '2026-04-09T10:00:00.000Z',
  });
  return startPromise;
}

describe('QwenOmniRealtimeProvider（Omni 实时 Provider 桥接）', () => {
  beforeEach(() => {
    tauriEventListeners.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'omni_realtime_session_start') {
        return 'omni-session-1';
      }
      return null;
    });
  });

  it('starts a session via tauri and attaches the event listener（通过 Tauri 启动会话并监听事件）', async () => {
    const received: Array<Record<string, unknown>> = [];
    const provider = new QwenOmniRealtimeProvider(
      {
        provider: VOICE_RUNTIME_OMNI_PROVIDER,
        modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
        sampleRate: 16000,
        apiKey: 'dashscope-api-key',
        websocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
        voice: 'Ethan',
        instructions: '你是 ExoMind 的实时语音助手',
      },
      {
        onRawEvent: (event) => {
          received.push(event);
        },
      },
    );

    const startPromise = provider.start();

    let settled = false;
    void startPromise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    await emitOmniRealtimeEvent({
      sessionId: 'omni-session-1',
      eventType: 'SessionStarted',
      model: `${'q'}wen3.5-omni-plus-realtime`,
      payload: { session_id: 'omni-session-1' },
      capturedAt: '2026-04-09T10:00:00.000Z',
    });

    await expect(startPromise).resolves.toBe('omni-session-1');

    expect(invokeMock).toHaveBeenCalledWith('omni_realtime_session_start', {
      config: expect.objectContaining({
        provider: VOICE_RUNTIME_OMNI_PROVIDER,
        modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      }),
    });
    expect(tauriEventListeners.get(OMNI_REALTIME_EVENT_NAME)?.size).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(expect.objectContaining({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      eventType: 'SessionStarted',
    }));
  });

  it('handles startup SessionStarted race before invoke resolves（处理 SessionStarted 早到竞态）', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'omni_realtime_session_start') {
        await emitOmniRealtimeEvent({
          sessionId: 'omni-session-race',
          eventType: 'SessionStarted',
          model: `${'q'}wen3.5-omni-plus-realtime`,
          payload: { session_id: 'omni-session-race' },
          capturedAt: '2026-04-09T10:00:00.250Z',
        });
        return 'omni-session-race';
      }
      return null;
    });

    const provider = new QwenOmniRealtimeProvider({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      sampleRate: 16000,
      apiKey: 'dashscope-api-key',
      websocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
      voice: 'Ethan',
      instructions: '你是 ExoMind 的实时语音助手',
    });

    await expect(provider.start()).resolves.toBe('omni-session-race');
    expect(provider.getSessionId()).toBe('omni-session-race');
  });

  it('pushes audio chunks through the active session（把音频分块推送到活跃会话）', async () => {
    const provider = new QwenOmniRealtimeProvider({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await provider.pushAudio(new Uint8Array([1, 2, 3, 4]));

    expect(invokeMock).toHaveBeenCalledWith('omni_realtime_session_push', {
      sessionId: 'omni-session-1',
      audioData: [1, 2, 3, 4],
    });
  });

  it('treats late push/finish as no-op after session is finished（会话结束后的尾随 push/finish 静默处理）', async () => {
    const provider = new QwenOmniRealtimeProvider({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await emitOmniRealtimeEvent({
      sessionId: 'omni-session-1',
      eventType: 'SessionFinished',
      payload: {},
      capturedAt: '2026-04-09T10:00:02.000Z',
    });

    const invokeCallCountBeforeLateOps = invokeMock.mock.calls.length;
    await expect(provider.pushAudio(new Uint8Array([4, 3, 2, 1]))).resolves.toBeUndefined();
    await expect(provider.finish(new Uint8Array([9, 9]))).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledTimes(invokeCallCountBeforeLateOps);
    expect(provider.getSessionId()).toBeNull();
  });

  it('swallows session-gone invoke errors for push/finish（push/finish 遇到会话已不存在时自动降级）', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'omni_realtime_session_start') {
        return 'omni-session-1';
      }
      if (command === 'omni_realtime_session_push') {
        throw new Error('Omni Realtime 会话不存在: omni-session-1');
      }
      if (command === 'omni_realtime_session_finish') {
        throw new Error('Omni Realtime 会话已关闭: omni-session-1');
      }
      return null;
    });

    const provider = new QwenOmniRealtimeProvider({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await expect(provider.pushAudio(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    await expect(provider.finish(new Uint8Array([7, 8]))).resolves.toBeUndefined();
    expect(provider.getSessionId()).toBeNull();
  });

  it('forwards audio chunks for TTSResponse events（把 TTSResponse 音频块转发给播放器回调）', async () => {
    const receivedAudio: Uint8Array[] = [];
    const provider = new QwenOmniRealtimeProvider(
      {
        provider: VOICE_RUNTIME_OMNI_PROVIDER,
        modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
        sampleRate: 16000,
      },
      {
        onAudioChunk: (chunk) => {
          receivedAudio.push(chunk);
        },
      },
    );

    await startProviderSession(provider);
    await emitOmniRealtimeEvent({
      sessionId: 'omni-session-1',
      eventType: 'TTSResponse',
      model: `${'q'}wen3.5-omni-plus-realtime`,
      audioData: [1, 2, 3, 4],
      audioFormat: 'pcm_s16le',
      sampleRate: 24000,
      capturedAt: '2026-04-09T10:00:01.500Z',
    });

    expect(receivedAudio).toHaveLength(1);
    expect(Array.from(receivedAudio[0])).toEqual([1, 2, 3, 4]);
  });

  it('finishes and cancels sessions via tauri commands（通过 Tauri 命令 finish / cancel 会话）', async () => {
    const provider = new QwenOmniRealtimeProvider({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await provider.finish(new Uint8Array([9, 8]));

    expect(invokeMock).toHaveBeenCalledWith('omni_realtime_session_finish', {
      sessionId: 'omni-session-1',
      audioData: [9, 8],
    });

    await emitOmniRealtimeEvent({
      sessionId: 'omni-session-1',
      eventType: 'SessionFinished',
      payload: {},
      capturedAt: '2026-04-09T10:00:02.000Z',
    });

    expect(provider.getSessionId()).toBeNull();
    await startProviderSession(provider);
    await provider.cancel();

    expect(invokeMock).toHaveBeenCalledWith('omni_realtime_session_cancel', {
      sessionId: 'omni-session-1',
    });
  });
});
