import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSseSignalTransport } from "../../src/sse/http-sse-signal-transport.js";

describe("HttpSseSignalTransport（Agent 侧 HTTP/SSE 传输适配器）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should POST publish requests through transport（publish 通过 transport 发出）", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-transport-1" }),
    });

    const transport = new HttpSseSignalTransport({
      rtUrl: "http://localhost:1949",
      source: "agent-test",
      timeout: 5000,
    });

    const response = await transport.publish({
      topic: "user.input.text",
      payload: { text: "hello" },
    });

    expect(response.event_id).toBe("evt-transport-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:1949/signals/publish",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("should include Last-Event-ID when opening stream（建立流时带上 Last-Event-ID）", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: vi.fn() },
    });

    const transport = new HttpSseSignalTransport({
      rtUrl: "http://localhost:1949",
      source: "agent-test",
      timeout: 5000,
    });

    await transport.openStream({
      agentId: "echo-test",
      heartbeatInterval: 15,
      lastEventId: "evt-last-7",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:1949/signals/stream?agent_id=echo-test&heartbeat_interval=15",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          "Last-Event-ID": "evt-last-7",
        }),
      }),
    );
  });
});
