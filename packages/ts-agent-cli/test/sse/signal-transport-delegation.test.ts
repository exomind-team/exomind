import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignalListener } from "../../src/sse/signal-listener.js";
import { SignalSender } from "../../src/sse/signal-sender.js";

describe("Signal sender/listener transport delegation（sender/listener 委托给 transport）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("SignalSender should delegate publish to provided transport（SignalSender 委托 publish）", async () => {
    const publish = vi.fn().mockResolvedValue({
      accepted: true,
      event_id: "evt-delegated",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-http" }),
    });

    const sender = new SignalSender({
      rtUrl: "http://localhost:1949",
      source: "agent-test",
      timeout: 5000,
      transport: {
        publish,
        openStream: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof SignalSender>[0]);

    const response = await sender.publish({
      topic: "test",
      payload: {},
    });

    expect(publish).toHaveBeenCalledWith({
      topic: "test",
      payload: {},
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(response.event_id).toBe("evt-delegated");
  });

  it("SignalListener should open streams through transport（SignalListener 通过 transport 建流）", async () => {
    const payload =
      'event:signal\ndata:{"schema_version":1,"id":"evt-1","topic":"test","ts":1,"source":"agent","origin_host_id":"local","hop":0,"payload":{}}\nid:evt-1\n\n';
    const encoder = new TextEncoder();
    let sent = false;
    const reader = {
      read: vi.fn().mockImplementation(async () => {
        if (!sent) {
          sent = true;
          return { done: false, value: encoder.encode(payload) };
        }
        return { done: true, value: undefined };
      }),
      releaseLock: vi.fn(),
    };

    const openStream = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });

    const listener = new SignalListener({
      rtUrl: "http://localhost:1949",
      agentId: "agent-test",
      transport: {
        publish: vi.fn(),
        openStream,
      },
    } as unknown as ConstructorParameters<typeof SignalListener>[0]);

    const events: Array<{ id: string }> = [];
    for await (const event of listener.listen()) {
      events.push(event as { id: string });
      listener.stop();
    }

    expect(openStream).toHaveBeenCalledWith({
      agentId: "agent-test",
      heartbeatInterval: 30,
      lastEventId: null,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("evt-1");
  });
});
