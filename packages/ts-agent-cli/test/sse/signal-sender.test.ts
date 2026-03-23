/**
 * SignalSender 单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignalSender } from "../../src/sse/signal-sender.js";

describe("SignalSender", () => {
  let sender: SignalSender;

  function fetchCalls(): Array<[string, RequestInit | undefined]> {
    return (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    sender = new SignalSender({
      rtUrl: "http://localhost:1949",
      source: "test-agent",
      timeout: 5000,
    });
  });

  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      const defaultSender = new SignalSender();
      expect(defaultSender).toBeDefined();
    });

    it("should strip trailing slash from rtUrl", () => {
      const s = new SignalSender({ rtUrl: "http://localhost:1949/" });
      expect((s as unknown as { rtUrl: string }).rtUrl).toBe(
        "http://localhost:1949",
      );
    });
  });

  describe("publish", () => {
    it("should return PublishResponse on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-001" }),
      });

      const result = await sender.publish({
        topic: "user.input.text",
        payload: { text: "hello" },
      });

      expect(result.accepted).toBe(true);
      expect(result.event_id).toBe("evt-001");
    });

    it("should POST to /signals/publish", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-002" }),
      });

      await sender.publish({
        topic: "test.topic",
        payload: {},
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:1949/signals/publish",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("should use default source when not specified in request", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-003" }),
      });

      await sender.publish({ topic: "test", payload: {} });

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.source).toBe("test-agent");
    });

    it("should preserve explicit source in request", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-004" }),
      });

      await sender.publish({
        topic: "test",
        payload: {},
        source: "custom-source",
      });

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.source).toBe("custom-source");
    });

    it("should include trace_id when provided", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-005" }),
      });

      await sender.publish({
        topic: "test",
        payload: {},
        trace_id: "trace-abc",
      });

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.trace_id).toBe("trace-abc");
    });

    it("should throw on HTTP error", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        sender.publish({ topic: "test", payload: {} }),
      ).rejects.toThrow("publish failed: HTTP 500");
    });

    it("should throw on network error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        sender.publish({ topic: "test", payload: {} }),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("send (convenience)", () => {
    it("should delegate to publish with topic + payload", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-010" }),
      });

      const result = await sender.send("echo.response", { echo: true });

      expect(result.accepted).toBe(true);

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.topic).toBe("echo.response");
      expect(body.payload).toEqual({ echo: true });
    });

    it("should pass traceId when provided", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true, event_id: "evt-011" }),
      });

      await sender.send("test", {}, "trace-xyz");

      const call = fetchCalls()[0];
      const body = JSON.parse(call![1]!.body as string);
      expect(body.trace_id).toBe("trace-xyz");
    });
  });
});
