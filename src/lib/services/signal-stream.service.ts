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
    this.abortController = new AbortController();

    const response = await this.transport.openStream({
      agentId: this.agentId,
      heartbeatInterval: this.heartbeatInterval,
      lastEventId: this.lastEventId,
      signal: this.abortController.signal,
    });

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
