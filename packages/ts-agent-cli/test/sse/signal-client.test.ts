/**
 * SignalClient 单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignalClient, createSignalClient } from "../../src/sse/signal-client.js";

describe("SignalClient", () => {
  function fetchCalls(): Array<[string, RequestInit | undefined]> {
    return (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const client = new SignalClient();
      expect(client).toBeDefined();
    });

    it("should create with custom config", () => {
      const client = new SignalClient({
        rtUrl: "http://localhost:1949",
        agentId: "echo-test",
        source: "echo-agent",
      });
      expect(client).toBeDefined();
    });
  });

  describe("publish", () => {
    it("should POST to /signals/publish", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-100" }),
      });

      const client = new SignalClient({
        rtUrl: "http://localhost:1949",
        source: "test",
      });

      const result = await client.publish({
        topic: "echo.response",
        payload: { echo: true },
      });

      expect(result.accepted).toBe(true);
      expect(result.event_id).toBe("evt-100");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1949/signals/publish",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("send (convenience)", () => {
    it("should publish topic + payload", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-101" }),
      });

      const client = new SignalClient({
        rtUrl: "http://localhost:1949",
        source: "test",
      });

      const result = await client.send("echo.response", { foo: "bar" });
      expect(result.accepted).toBe(true);

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.topic).toBe("echo.response");
      expect(body.payload).toEqual({ foo: "bar" });
    });
  });

  describe("stop", () => {
    it("should not throw when called before listen", () => {
      const client = new SignalClient();
      expect(() => client.stop()).not.toThrow();
    });
  });
});

describe("createSignalClient", () => {
  it("should return a SignalClient instance", () => {
    const client = createSignalClient({ rtUrl: "http://localhost:1949" });
    expect(client).toBeInstanceOf(SignalClient);
  });
});
