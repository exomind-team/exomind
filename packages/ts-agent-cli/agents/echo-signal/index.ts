/**
 * Echo Signal Agent
 *
 * 最小的 Echo Agent，用于验证 SignalPool 信号链路：
 *   浏览器发信号 → RT fanout → Echo Agent 收到
 *   → Echo Agent 发回 echo.response → 浏览器收到回显
 *
 * 运行：
 *   bun run packages/ts-agent-cli/agents/echo-signal/index.ts
 *
 * 环境变量：
 *   EXOMIND_RT_URL  - RT 地址 (默认 http://localhost:1949)
 *   ECHO_AGENT_ID   - Agent ID (默认 echo-test)
 */

import { SignalClient } from "../../src/sse/signal-client.js";
import type { SignalEvent } from "../../src/sse/signal-types.js";

const RT_URL = process.env["EXOMIND_RT_URL"] ?? "http://localhost:1949";
const AGENT_ID = process.env["ECHO_AGENT_ID"] ?? "echo-test";

console.log(`[EchoAgent] starting — rt=${RT_URL} agent_id=${AGENT_ID}`);

const client = new SignalClient({
  rtUrl: RT_URL,
  agentId: AGENT_ID,
  source: "echo-agent",
});

async function handleSignal(event: SignalEvent): Promise<void> {
  console.log(`[EchoAgent] received signal: topic=${event.topic} id=${event.id}`);

  try {
    const response = await client.publish({
      topic: "echo.response",
      payload: {
        original_topic: event.topic,
        original_id: event.id,
        original_payload: event.payload,
        echoed_at: Date.now(),
      },
      trace_id: event.trace_id,
      source: "echo-agent",
    });

    console.log(`[EchoAgent] echo published: event_id=${response.event_id}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[EchoAgent] echo publish failed: ${msg}`);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[EchoAgent] shutting down...");
  client.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[EchoAgent] shutting down...");
  client.stop();
  process.exit(0);
});

// Start listening
await client.listenWith(handleSignal);
