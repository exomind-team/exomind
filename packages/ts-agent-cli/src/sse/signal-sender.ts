/**
 * SignalPool 发送器 (Agent Shell 端)
 *
 * POST /signals/publish 发布信号到 Rust RT。
 */

import type { PublishRequest, PublishResponse } from "./signal-types.js";

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
}

// ── 发送器 ────────────────────────────────────────────────────

export class SignalSender {
  private readonly rtUrl: string;
  private readonly source: string;
  private readonly timeout: number;

  constructor(config?: Partial<SignalSenderConfig>) {
    this.rtUrl = (config?.rtUrl ?? DEFAULT_RT_URL).replace(/\/$/, "");
    this.source = config?.source ?? "agent";
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Publish a signal to the RT.
   */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    const url = `${this.rtUrl}/signals/publish`;
    const body: PublishRequest = {
      ...request,
      source: request.source ?? this.source,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`publish failed: HTTP ${response.status}`);
      }

      return (await response.json()) as PublishResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Convenience: publish a signal with just topic + payload.
   */
  async send(topic: string, payload: unknown, traceId?: string): Promise<PublishResponse> {
    return this.publish({ topic, payload, trace_id: traceId });
  }
}
