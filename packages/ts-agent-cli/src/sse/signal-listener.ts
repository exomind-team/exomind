/**
 * SignalPool SSE 监听器 (Agent Shell 端)
 *
 * 连接 Rust RT 的 GET /signals/stream?agent_id=xxx
 * 支持指数退避重连、Last-Event-ID 续传、心跳检测。
 */

import type { SignalEvent } from "./signal-types.js";

// ── 默认配置 ──────────────────────────────────────────────────

const DEFAULT_RT_URL = "http://localhost:1949";
const INITIAL_RETRY_DELAY_S = 1;
const MAX_RETRY_DELAY_S = 30;

// ── 配置 ──────────────────────────────────────────────────────

export interface SignalListenerConfig {
  /** RT base URL (e.g. http://localhost:1949) */
  rtUrl: string;
  /** Agent ID used in ?agent_id= */
  agentId: string;
  /** SSE heartbeat interval seconds (default: 30) */
  heartbeatInterval: number;
  /** Initial retry delay in seconds */
  initialRetryDelay: number;
  /** Maximum retry delay in seconds */
  maxRetryDelay: number;
}

// ── 监听器 ────────────────────────────────────────────────────

/**
 * SignalPool SSE 监听器
 *
 * 用法：
 * ```typescript
 * const listener = new SignalListener({ rtUrl, agentId: "echo-test" });
 * for await (const event of listener.listen()) {
 *   console.log("收到信号:", event.topic, event.payload);
 * }
 * ```
 */
export class SignalListener {
  private readonly rtUrl: string;
  private readonly agentId: string;
  private readonly heartbeatInterval: number;
  private retryDelay: number;
  private readonly maxRetryDelay: number;

  private aborted = false;
  private lastEventId: string | null = null;

  constructor(config?: Partial<SignalListenerConfig>) {
    this.rtUrl = (config?.rtUrl ?? DEFAULT_RT_URL).replace(/\/$/, "");
    this.agentId = config?.agentId ?? "agent";
    this.heartbeatInterval = config?.heartbeatInterval ?? 30;
    this.retryDelay = config?.initialRetryDelay ?? INITIAL_RETRY_DELAY_S;
    this.maxRetryDelay = config?.maxRetryDelay ?? MAX_RETRY_DELAY_S;
  }

  /**
   * Listen for SignalEvents with automatic reconnection.
   */
  async *listen(): AsyncGenerator<SignalEvent, void, void> {
    this.aborted = false;
    this.retryDelay = INITIAL_RETRY_DELAY_S;

    while (!this.aborted) {
      try {
        yield* this.connectAndConsume();
        this.retryDelay = INITIAL_RETRY_DELAY_S;
      } catch (error) {
        if (this.aborted) break;

        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[SignalListener] connection error: ${msg}`);

        await this.sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
        console.log(`[SignalListener] reconnecting in ${this.retryDelay}s...`);
      }
    }
  }

  /** Stop the listener. */
  stop(): void {
    this.aborted = true;
  }

  private get streamUrl(): string {
    return `${this.rtUrl}/signals/stream?agent_id=${encodeURIComponent(this.agentId)}&heartbeat_interval=${this.heartbeatInterval}`;
  }

  private async *connectAndConsume(): AsyncGenerator<SignalEvent, void, void> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }

    const response = await fetch(this.streamUrl, { headers });

    if (!response.ok) {
      throw new Error(`SSE HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    console.log(`[SignalListener] connected to ${this.streamUrl}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!this.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop()!;

        for (const raw of parts) {
          const event = this.parseRawEvent(raw);
          if (event) {
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseRawEvent(raw: string): SignalEvent | null {
    let eventType = "message";
    let data = "";
    let id: string | undefined;

    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trim();
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trim();
      }
    }

    if (id) {
      this.lastEventId = id;
    }

    if (eventType === "signal" && data) {
      try {
        return JSON.parse(data) as SignalEvent;
      } catch {
        console.warn("[SignalListener] failed to parse signal event:", data);
      }
    }

    return null;
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
