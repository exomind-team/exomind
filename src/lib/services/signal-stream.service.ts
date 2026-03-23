/**
 * SignalStream Service
 *
 * 前端 SSE 订阅客户端，连接 Rust RT 的 /signals/stream 端点。
 * 支持指数退避重连、Last-Event-ID 续传、心跳检测。
 */

import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { SignalEvent, PublishRequest, PublishResponse } from '@/lib/types/signal-pool';
import {
  buildSignalBaseUrl,
  buildSignalStreamUrl,
  HttpSseSignalTransport,
  type SignalTransport,
} from './signal-http-sse-transport';
import { log } from '@/lib/logger';

// ── 配置 ─────────────────────────────────────────────────────

const DEFAULT_AGENT_ID = 'ui';
const DEFAULT_HEARTBEAT_INTERVAL = 30;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ── 类型 ─────────────────────────────────────────────────────

export type SignalCallback = (event: SignalEvent) => void;

export interface SignalStreamServiceOptions {
  host: RuntimeHostRecord;
  agentId?: string;
  heartbeatInterval?: number;
  transport?: SignalTransport;
}

// ── Service ──────────────────────────────────────────────────

export class SignalStreamService {
  private readonly host: RuntimeHostRecord;
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly heartbeatInterval: number;
  private readonly transport: SignalTransport;

  private abortController: AbortController | null = null;
  private lastEventId: string | null = null;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private listeners: SignalCallback[] = [];
  private running = false;
  private lastConnectionErrorLog: string | null = null;

  constructor(options: SignalStreamServiceOptions) {
    this.host = options.host;
    this.baseUrl = buildSignalBaseUrl(options.host);
    this.agentId = options.agentId ?? DEFAULT_AGENT_ID;
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
    this.transport = options.transport ?? new HttpSseSignalTransport({ host: options.host });
  }

  /** Register a callback for incoming signals. */
  onSignal(callback: SignalCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  /** Start the SSE connection loop (auto-reconnects). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.retryDelay = INITIAL_RETRY_DELAY_MS;
    this.runLoop();
  }

  /** Stop the SSE connection and clean up. */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Publish a signal to the RT. */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    return this.transport.publish(request);
  }

  /** Fetch recent signal history from the RT. */
  async history(limit?: number): Promise<SignalEvent[]> {
    return this.transport.history(limit);
  }

  get isConnected(): boolean {
    return this.running && this.abortController !== null;
  }

  // ── 内部 ────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.connectAndConsume();
        // Connection ended cleanly (e.g. server closed) — reset retry delay.
        this.retryDelay = INITIAL_RETRY_DELAY_MS;
        this.lastConnectionErrorLog = null;
      } catch (error) {
        if (!this.running) break;

        if (error instanceof DOMException && error.name === 'AbortError') {
          continue;
        }

        const msg = error instanceof Error ? error.message : String(error);
        const logKey = `${this.baseUrl}::${msg}`;
        if (this.lastConnectionErrorLog !== logKey) {
          // RT 未启动时属于预期重试场景，避免持续 error 污染控制台
          log.warn(`[SignalStream] connection retry: ${msg} (target: ${this.baseUrl})`);
          this.lastConnectionErrorLog = logKey;
        }

        await this.sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * BACKOFF_MULTIPLIER, MAX_RETRY_DELAY_MS);
      }
    }
  }

  private async connectAndConsume(): Promise<void> {
    log.info(
      `[SignalStream] connect:start target=${this.baseUrl} agentId=${this.agentId} heartbeat=${this.heartbeatInterval}s resume=${this.lastEventId ? 'yes' : 'no'}`
    );
    this.abortController = new AbortController();

    let response: Response;
    try {
      response = await this.transport.openStream({
        agentId: this.agentId,
        heartbeatInterval: this.heartbeatInterval,
        lastEventId: this.lastEventId,
        signal: this.abortController.signal,
      });
    } catch (error) {
      await this.logFailureProbe('open-stream', error);
      if (this.shouldFallbackToEventSource(error)) {
        log.warn(
          `[SignalStream] fetch SSE failed, falling back to EventSource (target: ${this.baseUrl})`
        );
        await this.connectAndConsumeViaEventSource();
        return;
      }
      throw error;
    }

    const body = response.body;
    if (!body) {
      throw new Error('SSE response has no body');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines.
        const parts = buffer.split('\n\n');
        // Keep the last (potentially incomplete) part in the buffer.
        buffer = parts.pop()!;

        for (const raw of parts) {
          this.handleRawEvent(raw);
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
    }
  }

  private shouldFallbackToEventSource(error: unknown): boolean {
    if (typeof EventSource === 'undefined') {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('fetch');
  }

  private async connectAndConsumeViaEventSource(): Promise<void> {
    const streamUrl = buildSignalStreamUrl(
      this.baseUrl,
      this.agentId,
      this.heartbeatInterval,
      this.host.authToken,
    );
    const safeUrl = streamUrl.replace(/([?&]token=)[^&]+/i, '$1***');

    log.info(`[SignalStream] EventSource:start url=${safeUrl} resume=${this.lastEventId ? 'no-header' : 'none'}`);

    await new Promise<void>((_unusedResolve, reject) => {
      if (!this.abortController) {
        reject(new DOMException('Signal stream aborted', 'AbortError'));
        return;
      }

      let settled = false;
      const eventSource = new EventSource(streamUrl);
      let opened = false;

      const cleanup = () => {
        eventSource.removeEventListener('signal', handleSignal as EventListener);
        eventSource.removeEventListener('heartbeat', handleHeartbeat as EventListener);
        eventSource.removeEventListener('warning', handleWarning as EventListener);
        eventSource.close();
        this.abortController?.signal.removeEventListener('abort', handleAbort);
        this.abortController = null;
      };

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };

      const handleMessageEvent = (eventType: string, event: MessageEvent<string>) => {
        if (event.lastEventId) {
          this.lastEventId = event.lastEventId;
        }

        if (eventType !== 'signal') {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as SignalEvent;
          this.emit(payload);
        } catch {
          log.warn(`[SignalStream] failed to parse signal event: ${event.data}`);
        }
      };

      const handleSignal = ((event: MessageEvent<string>) => {
        handleMessageEvent('signal', event);
      }) as EventListener;

      const handleHeartbeat = ((event: MessageEvent<string>) => {
        handleMessageEvent('heartbeat', event);
      }) as EventListener;

      const handleWarning = ((event: MessageEvent<string>) => {
        handleMessageEvent('warning', event);
      }) as EventListener;

      const handleAbort = () => {
        finish(() => reject(new DOMException('Signal stream aborted', 'AbortError')));
      };

      eventSource.onopen = () => {
        opened = true;
        log.info(`[SignalStream] EventSource:open url=${safeUrl}`);
      };

      eventSource.onerror = () => {
        const message = opened
          ? 'EventSource stream closed unexpectedly'
          : 'EventSource failed before open';
        finish(() => reject(new Error(message)));
      };

      eventSource.addEventListener('signal', handleSignal);
      eventSource.addEventListener('heartbeat', handleHeartbeat);
      eventSource.addEventListener('warning', handleWarning);
      this.abortController.signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  private async logFailureProbe(stage: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[SignalStream] ${stage}:error target=${this.baseUrl} error=${message}`);

    try {
      const events = await this.transport.history(1);
      log.info(
        `[SignalStream] probe:history target=${this.baseUrl} ok count=${Array.isArray(events) ? events.length : 0}`
      );
    } catch (probeError) {
      log.warn(
        `[SignalStream] probe:history-failed target=${this.baseUrl} error=${probeError instanceof Error ? probeError.message : String(probeError)}`
      );
    }
  }

  private handleRawEvent(raw: string): void {
    let eventType = 'message';
    let data = '';
    let id: string | undefined;

    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      }
    }

    if (id) {
      this.lastEventId = id;
    }

    if (eventType === 'signal' && data) {
      try {
        const event = JSON.parse(data) as SignalEvent;
        this.emit(event);
      } catch {
        log.warn(`[SignalStream] failed to parse signal event: ${data}`);
      }
    }
    // heartbeat / warning events are silently consumed.
  }

  private emit(event: SignalEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (err) {
        log.error(`[SignalStream] listener error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Singleton ────────────────────────────────────────────────

let signalStreamInstance: SignalStreamService | null = null;

export function getSignalStreamService(options: SignalStreamServiceOptions): SignalStreamService {
  if (!signalStreamInstance) {
    signalStreamInstance = new SignalStreamService(options);
  }
  return signalStreamInstance;
}

export function resetSignalStreamServiceForTests(): void {
  signalStreamInstance?.stop();
  signalStreamInstance = null;
}
