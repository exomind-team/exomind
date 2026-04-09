import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import type { ProviderRawPerception } from '../types';
import type {
  DoubaoRealtimeEventPayload,
  VoiceRuntimeProvider,
  VoiceRuntimeAudioChunkMeta,
  VoiceRuntimeProviderCallbacks,
  VoiceRuntimeProviderConfig,
} from './types';

const DOUBAO_REALTIME_SESSION_START_COMMAND = 'doubao_realtime_session_start';
const DOUBAO_REALTIME_SESSION_PUSH_COMMAND = 'doubao_realtime_session_push';
const DOUBAO_REALTIME_SESSION_FINISH_COMMAND = 'doubao_realtime_session_finish';
const DOUBAO_REALTIME_SESSION_CANCEL_COMMAND = 'doubao_realtime_session_cancel';

export const DOUBAO_REALTIME_EVENT_NAME = 'doubao-realtime-event';
const DOUBAO_REALTIME_SESSION_READY_TIMEOUT_MS = 10_000;

function normalizeCapturedAt(value: string | undefined): string {
  return value?.trim() || new Date().toISOString();
}

function normalizePayload(
  config: VoiceRuntimeProviderConfig,
  payload: DoubaoRealtimeEventPayload,
): ProviderRawPerception {
  return {
    provider: config.provider,
    model: payload.model?.trim() || config.modelVersion,
    eventType: payload.eventType,
    payload: payload.payload ?? {},
    capturedAt: normalizeCapturedAt(payload.capturedAt),
  };
}

function normalizeAudioMeta(
  config: VoiceRuntimeProviderConfig,
  payload: DoubaoRealtimeEventPayload,
): VoiceRuntimeAudioChunkMeta {
  return {
    provider: config.provider,
    sessionId: payload.sessionId,
    eventType: payload.eventType,
    capturedAt: normalizeCapturedAt(payload.capturedAt),
    sampleRate: payload.sampleRate ?? config.ttsSampleRate ?? 24000,
    audioFormat: payload.audioFormat ?? config.ttsAudioFormat ?? 'pcm_s16le',
  };
}

export class DoubaoE2ERealtimeProvider implements VoiceRuntimeProvider {
  private sessionId: string | null = null;
  private sessionReady = false;
  private unlisten: (() => void) | null = null;
  private unlistenPromise: Promise<(() => void) | null> | null = null;
  private sessionReadyPromise: Promise<void> | null = null;
  private sessionReadyResolve: (() => void) | null = null;
  private sessionReadyReject: ((error: Error) => void) | null = null;
  private sessionReadyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: VoiceRuntimeProviderConfig,
    private readonly callbacks: VoiceRuntimeProviderCallbacks = {},
  ) {}

  getSessionId(): string | null {
    return this.sessionId;
  }

  async start(): Promise<string> {
    if (this.sessionId) {
      await this.waitForSessionReady();
      return this.sessionId;
    }

    await this.ensureListener();
    const sessionId = await invoke<string>(DOUBAO_REALTIME_SESSION_START_COMMAND, {
      config: this.config,
    });
    this.sessionId = sessionId;
    this.sessionReady = false;
    this.ensureSessionReadyPromise();
    await this.waitForSessionReady();
    return sessionId;
  }

  async pushAudio(chunk: Uint8Array): Promise<void> {
    await invoke(DOUBAO_REALTIME_SESSION_PUSH_COMMAND, {
      sessionId: this.requireSessionId(),
      audioData: Array.from(chunk),
    });
  }

  async finish(chunk: Uint8Array = new Uint8Array()): Promise<void> {
    const sessionId = this.requireSessionId();
    await invoke(DOUBAO_REALTIME_SESSION_FINISH_COMMAND, {
      sessionId,
      audioData: Array.from(chunk),
    });
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.sessionReady = false;
    this.rejectSessionReady(
      new Error('Doubao realtime session was cancelled before ready（豆包实时会话在就绪前被取消）'),
    );

    if (!sessionId) {
      return;
    }

    await invoke(DOUBAO_REALTIME_SESSION_CANCEL_COMMAND, { sessionId });
  }

  async dispose(): Promise<void> {
    await this.cancel();

    const pendingUnlisten = this.unlistenPromise;
    if (pendingUnlisten) {
      this.unlisten = await pendingUnlisten;
    }

    this.unlisten?.();
    this.unlisten = null;
    this.unlistenPromise = null;
  }

  private async ensureListener(): Promise<void> {
    if (this.unlisten) {
      return;
    }

    if (!this.unlistenPromise) {
      this.unlistenPromise = listen<DoubaoRealtimeEventPayload>(
        DOUBAO_REALTIME_EVENT_NAME,
        async (event) => {
          this.handleEvent(event.payload);
        },
      );
    }

    this.unlisten = await this.unlistenPromise;
  }

  private handleEvent(payload: DoubaoRealtimeEventPayload): void {
    const currentSessionId = this.sessionId;
    if (!currentSessionId || payload.sessionId !== currentSessionId) {
      return;
    }

    if (payload.eventType === 'SessionStarted') {
      this.sessionReady = true;
      this.resolveSessionReady();
    }

    if (
      payload.eventType === 'SessionFailed'
      || payload.eventType === 'ConnectionFailed'
      || payload.eventType === 'DialogCommonError'
      || payload.eventType === 'error'
    ) {
      this.rejectSessionReady(
        new Error(`Doubao realtime session failed before ready: ${payload.eventType}`),
      );
    }

    if (
      (payload.eventType === 'SessionFinished' || payload.eventType === 'ConnectionFinished')
      && !this.sessionReady
    ) {
      this.rejectSessionReady(
        new Error(`Doubao realtime session finished before ready: ${payload.eventType}`),
      );
    }

    const event = normalizePayload(this.config, payload);
    const callbackResult = this.callbacks.onRawEvent?.(event);
    if (callbackResult && typeof (callbackResult as Promise<void>).catch === 'function') {
      void (callbackResult as Promise<void>).catch((error) => {
        console.warn(
          'Doubao realtime provider raw event callback failed（豆包实时回调处理失败）',
          error,
        );
      });
    }

    if (payload.eventType === 'TTSResponse' && Array.isArray(payload.audioData) && payload.audioData.length > 0) {
      const chunk = new Uint8Array(payload.audioData);
      const audioMeta = normalizeAudioMeta(this.config, payload);
      const audioResult = this.callbacks.onAudioChunk?.(chunk, audioMeta);
      if (audioResult && typeof (audioResult as Promise<void>).catch === 'function') {
        void (audioResult as Promise<void>).catch((error) => {
          console.warn(
            'Doubao realtime provider audio callback failed（豆包实时音频回调处理失败）',
            error,
          );
        });
      }
    }

    if (payload.eventType === 'SessionFinished' || payload.eventType === 'SessionFailed' || payload.eventType === 'ConnectionFinished') {
      this.sessionId = null;
      this.sessionReady = false;
    }
  }

  private ensureSessionReadyPromise(): Promise<void> {
    if (this.sessionReadyPromise) {
      return this.sessionReadyPromise;
    }

    this.sessionReadyPromise = new Promise<void>((resolve, reject) => {
      this.sessionReadyResolve = resolve;
      this.sessionReadyReject = reject;
    });
    this.sessionReadyTimer = setTimeout(() => {
      this.rejectSessionReady(
        new Error(
          `Doubao realtime session start timed out after ${DOUBAO_REALTIME_SESSION_READY_TIMEOUT_MS}ms（豆包实时会话启动超时）`,
        ),
      );
    }, DOUBAO_REALTIME_SESSION_READY_TIMEOUT_MS);

    return this.sessionReadyPromise;
  }

  private async waitForSessionReady(): Promise<void> {
    if (this.sessionReady) {
      return;
    }

    await this.ensureSessionReadyPromise();
  }

  private resolveSessionReady(): void {
    if (this.sessionReadyTimer) {
      clearTimeout(this.sessionReadyTimer);
      this.sessionReadyTimer = null;
    }
    this.sessionReadyResolve?.();
    this.sessionReadyPromise = null;
    this.sessionReadyResolve = null;
    this.sessionReadyReject = null;
  }

  private rejectSessionReady(error: Error): void {
    if (this.sessionReadyTimer) {
      clearTimeout(this.sessionReadyTimer);
      this.sessionReadyTimer = null;
    }
    this.sessionReadyReject?.(error);
    this.sessionReadyPromise = null;
    this.sessionReadyResolve = null;
    this.sessionReadyReject = null;
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error('Doubao realtime session is not started（豆包实时会话尚未启动）');
    }
    return this.sessionId;
  }
}
