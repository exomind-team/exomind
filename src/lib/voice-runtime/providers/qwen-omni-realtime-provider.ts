import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import type { ProviderRawPerception } from '../types';
import type {
  QwenOmniRealtimeEventPayload,
  VoiceRuntimeProvider,
  VoiceRuntimeAudioChunkMeta,
  VoiceRuntimeProviderCallbacks,
  VoiceRuntimeProviderConfig,
} from './types';

const OMNI_REALTIME_SESSION_START_COMMAND = 'omni_realtime_session_start';
const OMNI_REALTIME_SESSION_PUSH_COMMAND = 'omni_realtime_session_push';
const OMNI_REALTIME_SESSION_FINISH_COMMAND = 'omni_realtime_session_finish';
const OMNI_REALTIME_SESSION_CANCEL_COMMAND = 'omni_realtime_session_cancel';

export const OMNI_REALTIME_EVENT_NAME = 'omni-realtime-event';
const OMNI_REALTIME_SESSION_READY_TIMEOUT_MS = 10_000;
const OMNI_REALTIME_BUFFERED_STARTUP_EVENT_LIMIT = 4;
const OMNI_REALTIME_BUFFERED_SESSION_LIMIT = 16;

function normalizeCapturedAt(value: string | undefined): string {
  return value?.trim() || new Date().toISOString();
}

function normalizePayload(
  config: VoiceRuntimeProviderConfig,
  payload: QwenOmniRealtimeEventPayload,
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
  payload: QwenOmniRealtimeEventPayload,
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

function extractFailureMessage(payload: QwenOmniRealtimeEventPayload): string | null {
  const detail = payload.payload;
  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const message = (detail as Record<string, unknown>).message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  const error = (detail as Record<string, unknown>).error;
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  const nestedError = error as Record<string, unknown> | undefined;
  const nestedMessage = nestedError?.message;
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
    return nestedMessage.trim();
  }

  return null;
}

export class QwenOmniRealtimeProvider implements VoiceRuntimeProvider {
  private sessionId: string | null = null;
  private sessionReady = false;
  private unlisten: (() => void) | null = null;
  private unlistenPromise: Promise<(() => void) | null> | null = null;
  private sessionReadyPromise: Promise<void> | null = null;
  private sessionReadyResolve: (() => void) | null = null;
  private sessionReadyReject: ((error: Error) => void) | null = null;
  private sessionReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingStartupEvents = new Map<string, QwenOmniRealtimeEventPayload[]>();

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
    const sessionId = await invoke<string>(OMNI_REALTIME_SESSION_START_COMMAND, {
      config: this.config,
    });
    this.sessionId = sessionId;
    this.sessionReady = false;
    this.ensureSessionReadyPromise();
    this.flushPendingStartupEvents(sessionId);
    await this.waitForSessionReady();
    return sessionId;
  }

  async pushAudio(chunk: Uint8Array): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId || chunk.byteLength === 0) {
      return;
    }

    try {
      await invoke(OMNI_REALTIME_SESSION_PUSH_COMMAND, {
        sessionId,
        audioData: Array.from(chunk),
      });
    } catch (error) {
      if (this.isSessionAlreadyClosedError(error)) {
        this.sessionId = null;
        this.sessionReady = false;
        return;
      }
      throw error;
    }
  }

  async finish(chunk: Uint8Array = new Uint8Array()): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) {
      return;
    }

    try {
      await invoke(OMNI_REALTIME_SESSION_FINISH_COMMAND, {
        sessionId,
        audioData: Array.from(chunk),
      });
    } catch (error) {
      if (this.isSessionAlreadyClosedError(error)) {
        this.sessionId = null;
        this.sessionReady = false;
        return;
      }
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.sessionReady = false;
    this.pendingStartupEvents.clear();
    this.rejectSessionReady(
      new Error('Omni realtime session was cancelled before ready（Omni 实时会话在就绪前被取消）'),
    );

    if (!sessionId) {
      return;
    }

    await invoke(OMNI_REALTIME_SESSION_CANCEL_COMMAND, { sessionId });
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
      this.unlistenPromise = listen<QwenOmniRealtimeEventPayload>(
        OMNI_REALTIME_EVENT_NAME,
        async (event) => {
          this.handleEvent(event.payload);
        },
      );
    }

    this.unlisten = await this.unlistenPromise;
  }

  private handleEvent(payload: QwenOmniRealtimeEventPayload): void {
    const currentSessionId = this.sessionId;
    if (!currentSessionId) {
      this.bufferPendingStartupEvent(payload);
      return;
    }
    if (payload.sessionId !== currentSessionId) {
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
      const failureMessage = extractFailureMessage(payload);
      this.rejectSessionReady(
        new Error(
          failureMessage
            ? `Omni realtime session failed before ready: ${payload.eventType} (${failureMessage})`
            : `Omni realtime session failed before ready: ${payload.eventType}`,
        ),
      );
    }

    if (
      (payload.eventType === 'SessionFinished' || payload.eventType === 'ConnectionFinished')
      && !this.sessionReady
    ) {
      this.rejectSessionReady(
        new Error(`Omni realtime session finished before ready: ${payload.eventType}`),
      );
    }

    const event = normalizePayload(this.config, payload);
    const callbackResult = this.callbacks.onRawEvent?.(event);
    if (callbackResult && typeof (callbackResult as Promise<void>).catch === 'function') {
      void (callbackResult as Promise<void>).catch((error) => {
        console.warn(
          'Omni realtime provider raw event callback failed（Omni 实时回调处理失败）',
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
            'Omni realtime provider audio callback failed（Omni 实时音频回调处理失败）',
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

  private bufferPendingStartupEvent(payload: QwenOmniRealtimeEventPayload): void {
    if (!this.isStartupEvent(payload.eventType)) {
      return;
    }
    const buffered = this.pendingStartupEvents.get(payload.sessionId) ?? [];
    buffered.push(payload);
    this.pendingStartupEvents.set(
      payload.sessionId,
      buffered.slice(-OMNI_REALTIME_BUFFERED_STARTUP_EVENT_LIMIT),
    );

    if (this.pendingStartupEvents.size <= OMNI_REALTIME_BUFFERED_SESSION_LIMIT) {
      return;
    }
    const oldestSessionId = this.pendingStartupEvents.keys().next().value as string | undefined;
    if (oldestSessionId) {
      this.pendingStartupEvents.delete(oldestSessionId);
    }
  }

  private flushPendingStartupEvents(sessionId: string): void {
    const buffered = this.pendingStartupEvents.get(sessionId);
    if (!buffered || buffered.length === 0) {
      return;
    }
    this.pendingStartupEvents.delete(sessionId);
    for (const payload of buffered) {
      this.handleEvent(payload);
    }
  }

  private isStartupEvent(eventType: string): boolean {
    return (
      eventType === 'SessionStarted'
      || eventType === 'SessionFailed'
      || eventType === 'ConnectionFailed'
      || eventType === 'DialogCommonError'
      || eventType === 'error'
      || eventType === 'SessionFinished'
      || eventType === 'ConnectionFinished'
    );
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
          `Omni realtime session start timed out after ${OMNI_REALTIME_SESSION_READY_TIMEOUT_MS}ms（Omni 实时会话启动超时）`,
        ),
      );
    }, OMNI_REALTIME_SESSION_READY_TIMEOUT_MS);

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

  private isSessionAlreadyClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.trim()) {
      return false;
    }

    const normalized = message.toLowerCase();
    return (
      normalized.includes('omni realtime 会话不存在')
      || normalized.includes('omni realtime 会话已关闭')
      || normalized.includes('omni realtime push 确认通道已关闭')
      || normalized.includes('omni realtime finish 确认通道已关闭')
      || normalized.includes('session not found')
      || normalized.includes('session closed')
      || normalized.includes('session does not exist')
    );
  }
}
