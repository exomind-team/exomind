/**
 * SignalListener 单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignalListener } from "../../src/sse/signal-listener.js";

describe("SignalListener", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default config", () => {
      const listener = new SignalListener();
      expect(listener).toBeDefined();
    });

    it("should accept custom config", () => {
      const listener = new SignalListener({
        rtUrl: "http://custom:9999",
        agentId: "my-agent",
        heartbeatInterval: 10,
        initialRetryDelay: 2,
        maxRetryDelay: 60,
      });
      expect(listener).toBeDefined();
    });
  });

  describe("stop", () => {
    it("should stop the listener", () => {
      const listener = new SignalListener();
      listener.stop();
      // After stop, listen() should exit immediately.
      expect(listener).toBeDefined();
    });
  });

  describe("listen", () => {
    it("should yield SignalEvent objects from SSE stream", async () => {
      const ssePayload = [
        'event:signal\ndata:{"schema_version":1,"id":"evt-1","topic":"test","ts":1700000000000,"source":"src","origin_host_id":"local","hop":0,"payload":{"hello":"world"}}\nid:evt-1\n\n',
        'event:heartbeat\ndata:{"ts":1700000001000}\n\n',
        'event:signal\ndata:{"schema_version":1,"id":"evt-2","topic":"test","ts":1700000002000,"source":"src","origin_host_id":"local","hop":0,"payload":{"hi":"there"}}\nid:evt-2\n\n',
      ].join("");

      const encoder = new TextEncoder();
      const chunks = [encoder.encode(ssePayload)];
      let chunkIndex = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < chunks.length) {
            const value = chunks[chunkIndex]!;
            chunkIndex++;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const listener = new SignalListener({
        rtUrl: "http://localhost:1949",
        agentId: "test-agent",
      });

      const events: unknown[] = [];
      for await (const event of listener.listen()) {
        events.push(event);
        if (events.length >= 2) {
          listener.stop();
        }
      }

      expect(events).toHaveLength(2);
      expect((events[0] as { id: string }).id).toBe("evt-1");
      expect((events[0] as { topic: string }).topic).toBe("test");
      expect((events[1] as { id: string }).id).toBe("evt-2");
    });

    it("should skip heartbeat events", async () => {
      const ssePayload =
        'event:heartbeat\ndata:{"ts":1700000000000}\n\n' +
        'event:signal\ndata:{"schema_version":1,"id":"evt-1","topic":"t","ts":0,"source":"s","origin_host_id":"l","hop":0,"payload":{}}\nid:evt-1\n\n';

      const encoder = new TextEncoder();
      let sent = false;

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (!sent) {
            sent = true;
            return { done: false, value: encoder.encode(ssePayload) };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const listener = new SignalListener({
        rtUrl: "http://localhost:1949",
        agentId: "test",
      });

      const events: unknown[] = [];
      for await (const event of listener.listen()) {
        events.push(event);
        listener.stop();
      }

      // Only signal events should be yielded, not heartbeats.
      expect(events).toHaveLength(1);
      expect((events[0] as { id: string }).id).toBe("evt-1");
    });

    it("should build correct stream URL", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const listener = new SignalListener({
        rtUrl: "http://localhost:1949",
        agentId: "my-agent",
        heartbeatInterval: 15,
      });

      // listen() will try to connect, fail with HTTP 500, retry, and we stop.
      const gen = listener.listen();
      // Trigger the first iteration (which calls fetch).
      const nextPromise = gen.next();
      // Wait a tick for the fetch call to happen.
      await new Promise((r) => setTimeout(r, 50));
      listener.stop();
      await nextPromise.catch(() => {});

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1949/signals/stream?agent_id=my-agent&heartbeat_interval=15",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "text/event-stream",
          }),
        }),
      );
    });
  });
});
