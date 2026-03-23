/**
 * SignalPool 客户端 (Agent Shell 端)
 *
 * 集成 SignalListener + SignalSender 的组合客户端。
 */

import type { SignalEvent, PublishRequest, PublishResponse } from "./signal-types.js";
import { SignalListener } from "./signal-listener.js";
import type { SignalListenerConfig } from "./signal-listener.js";
import { SignalSender } from "./signal-sender.js";
import type { SignalSenderConfig } from "./signal-sender.js";

// ── 配置 ──────────────────────────────────────────────────────

export interface SignalClientConfig extends Partial<SignalListenerConfig>, Partial<SignalSenderConfig> {}

// ── 客户端 ────────────────────────────────────────────────────

/**
 * SignalPool 组合客户端
 *
 * 用法：
 * ```typescript
 * const client = new SignalClient({
 *   rtUrl: "http://localhost:1949",
 *   agentId: "echo-test",
 *   source: "echo-agent",
 * });
 *
 * for await (const event of client.listen()) {
 *   console.log("收到:", event.topic);
 *   await client.publish({ topic: "echo.response", payload: event.payload });
 * }
 * ```
 */
export class SignalClient {
  private readonly listener: SignalListener;
  private readonly sender: SignalSender;

  constructor(config?: SignalClientConfig) {
    this.listener = new SignalListener(config);
    this.sender = new SignalSender(config);
  }

  /** Listen for signals with auto-reconnection. */
  async *listen(): AsyncGenerator<SignalEvent, void, void> {
    yield* this.listener.listen();
  }

  /** Listen and handle each signal with a callback. */
  async listenWith(handler: (event: SignalEvent) => Promise<void> | void): Promise<void> {
    for await (const event of this.listen()) {
      await handler(event);
    }
  }

  /** Publish a signal. */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    return this.sender.publish(request);
  }

  /** Convenience: publish topic + payload. */
  async send(topic: string, payload: unknown, traceId?: string): Promise<PublishResponse> {
    return this.sender.send(topic, payload, traceId);
  }

  /** Stop listening. */
  stop(): void {
    this.listener.stop();
  }
}

// ── 工厂函数 ──────────────────────────────────────────────────

export function createSignalClient(config?: SignalClientConfig): SignalClient {
  return new SignalClient(config);
}
