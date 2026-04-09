import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  DOUBAO_REALTIME_EVENT_NAME,
  DoubaoE2ERealtimeProvider,
} from '@/lib/voice-runtime/providers/doubao-e2e-realtime-provider';

async function emitDoubaoRealtimeEvent(payload: Record<string, unknown>): Promise<void> {
  const listeners = Array.from(tauriEventListeners.get(DOUBAO_REALTIME_EVENT_NAME) ?? []);
  await Promise.all(listeners.map((listener) => listener({ payload })));
  await Promise.resolve();
}

async function startProviderSession(
  provider: DoubaoE2ERealtimeProvider,
  sessionId = 'doubao-session-1',
): Promise<string> {
  const startPromise = provider.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await emitDoubaoRealtimeEvent({
    sessionId,
    eventType: 'SessionStarted',
    model: '1.2.1.1',
    payload: { dialog_id: 'dialog-1' },
    capturedAt: '2026-04-08T10:00:00.000Z',
  });
  return startPromise;
}

describe('DoubaoE2ERealtimeProvider（豆包实时语音 Provider 桥接）', () => {
  beforeEach(() => {
    tauriEventListeners.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'doubao_realtime_session_start') {
        return 'doubao-session-1';
      }
      return null;
    });
  });

  it('starts a session via tauri and attaches the event listener（通过 Tauri 启动会话并监听事件）', async () => {
    const received: Array<Record<string, unknown>> = [];
    const provider = new DoubaoE2ERealtimeProvider(
      {
        provider: 'doubao-o2-realtime',
        modelVersion: '1.2.1.1',
        sampleRate: 16000,
        language: 'zh-CN',
        appId: '4587429383',
        accessToken: 'vei-access-token',
        secretKey: 'vei-secret-key',
        websocketUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
        connectId: 'connect-1',
        speaker: 'zh_female_vv_jupiter_bigtts',
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

    await emitDoubaoRealtimeEvent({
      sessionId: 'doubao-session-1',
      eventType: 'SessionStarted',
      model: '1.2.1.1',
      payload: { dialog_id: 'dialog-1' },
      capturedAt: '2026-04-08T10:00:00.000Z',
    });

    await expect(startPromise).resolves.toBe('doubao-session-1');

    expect(invokeMock).toHaveBeenCalledWith('doubao_realtime_session_start', {
      config: {
        provider: 'doubao-o2-realtime',
        modelVersion: '1.2.1.1',
        sampleRate: 16000,
        language: 'zh-CN',
        appId: '4587429383',
        accessToken: 'vei-access-token',
        secretKey: 'vei-secret-key',
        websocketUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
        connectId: 'connect-1',
        speaker: 'zh_female_vv_jupiter_bigtts',
      },
    });
    expect(tauriEventListeners.get(DOUBAO_REALTIME_EVENT_NAME)?.size).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(expect.objectContaining({
      provider: 'doubao-o2-realtime',
      eventType: 'SessionStarted',
    }));
  });

  it('pushes audio chunks through the active session（把音频分块推送到活跃会话）', async () => {
    const provider = new DoubaoE2ERealtimeProvider({
      provider: 'doubao-o2-realtime',
      modelVersion: '1.2.1.1',
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await provider.pushAudio(new Uint8Array([1, 2, 3, 4]));

    expect(invokeMock).toHaveBeenCalledWith('doubao_realtime_session_push', {
      sessionId: 'doubao-session-1',
      audioData: [1, 2, 3, 4],
    });
  });

  it('forwards only matching provider events as raw perception（只转发当前会话的原始事件）', async () => {
    const received: Array<Record<string, unknown>> = [];
    const provider = new DoubaoE2ERealtimeProvider(
      {
        provider: 'doubao-o2-realtime',
        modelVersion: '1.2.1.1',
        sampleRate: 16000,
      },
      {
        onRawEvent: (event) => {
          received.push(event);
        },
      },
    );

    await startProviderSession(provider);
    received.length = 0;

    await emitDoubaoRealtimeEvent({
      sessionId: 'other-session',
      eventType: 'ASRResponse',
      model: '1.2.1.1',
      payload: { results: [{ text: 'ignored', is_interim: true }] },
      capturedAt: '2026-04-08T10:00:00.000Z',
    });
    await emitDoubaoRealtimeEvent({
      sessionId: 'doubao-session-1',
      eventType: 'ASRResponse',
      model: '1.2.1.1',
      payload: { results: [{ text: '你好', is_interim: true }] },
      capturedAt: '2026-04-08T10:00:01.000Z',
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(expect.objectContaining({
      provider: 'doubao-o2-realtime',
      model: '1.2.1.1',
      eventType: 'ASRResponse',
      payload: { results: [{ text: '你好', is_interim: true }] },
      capturedAt: '2026-04-08T10:00:01.000Z',
    }));
  });

  it('forwards audio chunks for TTSResponse events（把 TTSResponse 音频块转发给播放器回调）', async () => {
    const receivedAudio: Uint8Array[] = [];
    const provider = new DoubaoE2ERealtimeProvider(
      {
        provider: 'doubao-o2-realtime',
        modelVersion: '1.2.1.1',
        sampleRate: 16000,
      },
      {
        onAudioChunk: (chunk) => {
          receivedAudio.push(chunk);
        },
      },
    );

    await startProviderSession(provider);

    await emitDoubaoRealtimeEvent({
      sessionId: 'doubao-session-1',
      eventType: 'TTSResponse',
      model: '1.2.1.1',
      payload: {
        audioFormat: 'pcm_s16le',
        sampleRate: 24000,
        byteLength: 4,
      },
      audioData: [1, 2, 3, 4],
      capturedAt: '2026-04-08T10:00:01.500Z',
    });

    expect(receivedAudio).toHaveLength(1);
    expect(Array.from(receivedAudio[0])).toEqual([1, 2, 3, 4]);
  });

  it('finishes and cancels sessions via tauri commands（通过 Tauri 命令 finish / cancel 会话）', async () => {
    const provider = new DoubaoE2ERealtimeProvider({
      provider: 'doubao-o2-realtime',
      modelVersion: '1.2.1.1',
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    await provider.finish(new Uint8Array([9, 8]));

    expect(invokeMock).toHaveBeenCalledWith('doubao_realtime_session_finish', {
      sessionId: 'doubao-session-1',
      audioData: [9, 8],
    });
    expect(provider.getSessionId()).toBe('doubao-session-1');

    await emitDoubaoRealtimeEvent({
      sessionId: 'doubao-session-1',
      eventType: 'SessionFinished',
      payload: {},
      capturedAt: '2026-04-08T10:00:02.000Z',
    });

    expect(provider.getSessionId()).toBeNull();

    await startProviderSession(provider);
    await provider.cancel();

    expect(invokeMock).toHaveBeenCalledWith('doubao_realtime_session_cancel', {
      sessionId: 'doubao-session-1',
    });
  });

  it('disposes the listener and clears the active session（释放监听并清理会话）', async () => {
    const provider = new DoubaoE2ERealtimeProvider({
      provider: 'doubao-o2-realtime',
      modelVersion: '1.2.1.1',
      sampleRate: 16000,
    });

    await startProviderSession(provider);
    expect(provider.getSessionId()).toBe('doubao-session-1');

    await provider.dispose();

    expect(provider.getSessionId()).toBeNull();
    expect(tauriEventListeners.get(DOUBAO_REALTIME_EVENT_NAME)?.size ?? 0).toBe(0);
    expect(invokeMock).toHaveBeenCalledWith('doubao_realtime_session_cancel', {
      sessionId: 'doubao-session-1',
    });
  });
});
