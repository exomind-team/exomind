/**
 * SignalPool 发送器 (Agent Shell 端)
 *
 * POST /signals/publish 发布信号到 Rust RT。
 */

import type { PublishRequest, PublishResponse } from "./signal-types.js";
import { HttpSseSignalTransport, type SignalTransport } from "./http-sse-signal-transport.js";

// ── 默认配置 ──────────────────────────────────────────────────

const DEFAULT_RT_URL = "http://localhost:1949";
const DEFAULT_TIMEOUT_MS = 10_000;

// ── 配置 ──────────────────────────────────────────────────────

export interface SignalSenderConfig {
  /** RT base URL (e.g. http://localhost:1949) */
  rtUrl: string;
  /** Default source identifier */
  source: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Transport adapter（传输适配器） */
  transport: SignalTransport;
}

// ── 发送器 ────────────────────────────────────────────────────

export class SignalSender {
  private readonly rtUrl: string;
  private readonly source: string;
  private readonly timeout: number;
  private readonly transport: SignalTransport;

  constructor(config?: Partial<SignalSenderConfig>) {
    this.rtUrl = (config?.rtUrl ?? DEFAULT_RT_URL).replace(/\/$/, "");
    this.source = config?.source ?? "agent";
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
    this.transport =
      config?.transport ??
      new HttpSseSignalTransport({
        rtUrl: this.rtUrl,
        source: this.source,
        timeout: this.timeout,
      });
  }

  /**
   * Publish a signal to the RT.
   */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    return this.transport.publish(request);
  }

  /**
   * Convenience: publish a signal with just topic + payload.
   */
  async send(topic: string, payload: unknown, traceId?: string): Promise<PublishResponse> {
    return this.publish({ topic, payload, trace_id: traceId });
  }
}
