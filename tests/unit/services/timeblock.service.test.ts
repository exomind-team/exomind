import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getEventStorageMock,
  addEventMock,
  loadEventsMock,
  getEventLogServiceMock,
  getFeedbackPreferencesMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  // addEventMock intercepts appendEventWithEcsReplication (RT eventlog write path).
  addEventMock: vi
    .fn()
    .mockResolvedValue({
      id: "evt-mock",
      timestamp: 1700000000000,
      content: "",
      tags: [],
    }),
  loadEventsMock: vi.fn(),
  getEventLogServiceMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

const networkMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("../../../src/lib/storage/event-storage", () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock("@/config/feedback-preferences", () => ({
  getFeedbackPreferences: getFeedbackPreferencesMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
}));

// RT eventlog write path: intercept appendEventWithEcsReplication so event writes
// don't hit globalThis.fetch (which is reserved for signal publish assertions).
vi.mock(
  "@/lib/services/ecs-eventlog-replication.service",
  async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return { ...actual, appendEventWithEcsReplication: addEventMock };
  },
);

// RT eventlog read path: intercept getEventLogService so loadEvents() uses loadEventsMock.
vi.mock("@/lib/services/eventlog.service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getEventLogService: getEventLogServiceMock };
});

import { TimeBlockServiceImpl } from "@/lib/services/timeblock.service";
import { DEFAULT_EMBEDDED_RUNTIME_PORT } from "@/config/runtime-target";
import { resolveLocalServiceHost } from "@/config/local-service-host";

type MemoryEnv = {
  storage: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
};

function createMemoryEnv(): MemoryEnv {
  const data = new Map<string, unknown>();
  return {
    storage: {
      async read<T>(key: string) {
        return (data.has(key) ? data.get(key) : null) as T | null;
      },
      async write(key: string, value: unknown) {
        data.set(key, value);
      },
      async delete(key: string) {
        data.delete(key);
      },
    },
  };
}

function createStorage(addEventImpl = addEventMock) {
  return {
    addEvent: addEventImpl,
    getEvents: vi.fn().mockResolvedValue([]),
  };
}

describe("TimeBlockServiceImpl", () => {
  beforeEach(() => {
    window.localStorage.clear();
    addEventMock.mockReset();
    addEventMock.mockResolvedValue({
      id: "evt-mock",
      timestamp: 1700000000000,
      content: "",
      tags: [],
    });
    loadEventsMock.mockReset();
    loadEventsMock.mockResolvedValue([]);
    getEventLogServiceMock.mockReset();
    getEventLogServiceMock.mockReturnValue({ loadEvents: loadEventsMock });
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue(createStorage());
    getFeedbackPreferencesMock.mockReset();
    getFeedbackPreferencesMock.mockReturnValue({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: true,
    });
    tauriMocks.isTauri.mockReset();
    tauriMocks.invoke.mockReset();
    tauriMocks.isTauri.mockResolvedValue(false);
    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-default-mock" }),
    });
    vi.stubGlobal("fetch", networkMocks.fetch as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("initializes countdown blocks with remaining milliseconds from minutes", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const block = await service.startBlock("deep work", {
      mode: "countdown",
      minutes: 25,
    });
    const stored = await service.loadActiveBlock();

    expect(block.elapsed).toBe(25 * 60 * 1000);
    expect(block.targetMinutes).toBe(25);
    expect(stored?.elapsed).toBeLessThanOrEqual(25 * 60 * 1000);
    expect(stored?.elapsed).toBeGreaterThanOrEqual(25 * 60 * 1000 - 2000);
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "block_start" }),
    );

    const blockStartCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_start");
    expect(blockStartCall).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: expect.objectContaining({
            app: "ExoMind",
            deviceId: expect.any(String),
            deviceName: expect.any(String),
            platform: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("writes block_feedback event when ending with feedback", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("write tests", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("felt good");

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "block_end" }),
    );
    expect(feedbackCall).toEqual(
      expect.objectContaining({
        type: "block_feedback",
        content: expect.stringContaining("预期时长：**`∞`**"),
        metadata: expect.objectContaining({
          expectedDurationMs: null,
        }),
      }),
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "### 快速反馈",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "反馈状态：**`已填写`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期差异：**`无预期（正计时）`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期结束于：`∞`",
    );
    expect((feedbackCall as { content: string }).content).not.toContain(
      "超时投入",
    );
    expect((feedbackCall as { content: string }).content).toContain("---");
    expect((feedbackCall as { content: string }).content).toContain(
      "felt good",
    );
  });

  it("writes block_feedback event when ending without feedback", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("write tests", { mode: "countup" });
    await service.markEnding();
    await service.endBlock();

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect(feedbackCall).toEqual(
      expect.objectContaining({
        type: "block_feedback",
        metadata: expect.objectContaining({
          expectedDurationMs: null,
        }),
      }),
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "### 快速反馈",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "反馈状态：**`未填写`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期差异：**`无预期（正计时）`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期时长：**`∞`**",
    );
    expect((feedbackCall as { content: string }).content).not.toContain(
      "超时投入",
    );
    expect((feedbackCall as { content: string }).content).not.toContain("---");
    expect((feedbackCall as { content: string }).content).not.toContain(
      "（未填写）",
    );
  });

  it("stores countdown expected duration in metadata and reports overtime based on workDuration", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-13T08:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("focus countdown", {
      mode: "countdown",
      minutes: 1,
    });

    vi.setSystemTime(new Date(base.getTime() + 90_000));
    await service.markEnding();

    vi.setSystemTime(new Date(base.getTime() + 95_000));
    await service.endBlock("overtime happened");

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect(feedbackCall).toEqual(
      expect.objectContaining({
        type: "block_feedback",
        metadata: expect.objectContaining({
          expectedDurationMs: 60_000,
          workDurationMs: 90_000,
        }),
      }),
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期结束于：`",
    );
    expect((feedbackCall as { content: string }).content).not.toContain(
      "预期结束于：`∞`",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期时长：**`01:00`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "超时投入：**`00:30`**",
    );
    expect((feedbackCall as { content: string }).content).toContain(
      "预期差异：**`🕒工作超时00:30`**",
    );
  });

  it("reports early finish diff when action ends before expected end", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-13T09:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("finish early", { mode: "countdown", minutes: 1 });

    vi.setSystemTime(new Date(base.getTime() + 30_000));
    await service.markEnding();
    vi.setSystemTime(new Date(base.getTime() + 33_000));
    await service.endBlock("done");

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect((feedbackCall as { content: string }).content).toContain(
      "预期差异：**`🚀提前00:30完成`**",
    );
  });

  it("reports delayed end diff when action ends late but work is still below expected duration", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-13T10:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("late but within work", {
      mode: "countdown",
      minutes: 1,
    });

    vi.setSystemTime(new Date(base.getTime() + 20_000));
    await service.pauseBlock();
    vi.setSystemTime(new Date(base.getTime() + 90_000));
    await service.markEnding();
    vi.setSystemTime(new Date(base.getTime() + 95_000));
    await service.endBlock("done");

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect((feedbackCall as { content: string }).content).toContain(
      "预期差异：**`✨时间块已完成，超出预期结束时间00:30`**",
    );
  });

  it("accumulates paused duration and stores durations in feedback metadata", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-11T08:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("focus", { mode: "countup" });

    vi.setSystemTime(new Date(base.getTime() + 10_000));
    await service.pauseBlock();

    vi.setSystemTime(new Date(base.getTime() + 15_000));
    await service.resumeBlock();

    vi.setSystemTime(new Date(base.getTime() + 35_000));
    await service.markEnding();

    vi.setSystemTime(new Date(base.getTime() + 42_000));
    await service.endBlock("done");

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "block_feedback");

    expect(feedbackCall).toBeTruthy();
    expect(feedbackCall).toEqual(
      expect.objectContaining({
        type: "block_feedback",
        metadata: expect.objectContaining({
          actionDurationMs: 35_000,
          feedbackDurationMs: 7_000,
          pausedDurationMs: 5_000,
          workDurationMs: 30_000,
          totalDurationMs: 42_000,
          expectedDurationMs: null,
        }),
      }),
    );
  });

  it("writes block_start, block_end, and block_feedback events for a full block lifecycle", async () => {
    const env = createMemoryEnv();

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("focus", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    const types = addEventMock.mock.calls.map(
      ([event]) => (event as { type?: string }).type,
    );
    expect(types).toContain("block_start");
    expect(types).toContain("block_end");
    expect(types).toContain("block_feedback");
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "block_start" }),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "block_end" }),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "block_feedback",
        content: expect.stringContaining("done"),
      }),
    );
  });

  it("recalculates elapsed time on load for running blocks", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-11T08:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("focus", { mode: "countup" });

    vi.setSystemTime(new Date(base.getTime() + 5000));
    const active = await service.loadActiveBlock();

    expect(active?.paused).toBe(false);
    expect(active?.elapsed).toBeGreaterThanOrEqual(5000);
  });

  it("keeps elapsed stable while paused even after time passes", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-02-11T09:00:00.000Z");
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("pause-check", { mode: "countup" });

    vi.setSystemTime(new Date(base.getTime() + 3000));
    await service.pauseBlock();
    const paused = await service.loadActiveBlock();

    vi.setSystemTime(new Date(base.getTime() + 9000));
    const stillPaused = await service.loadActiveBlock();

    expect(paused?.paused).toBe(true);
    expect(stillPaused?.paused).toBe(true);
    expect(paused?.elapsed).toBeGreaterThanOrEqual(3000);
    expect(stillPaused?.elapsed).toBe(paused?.elapsed);
  });

  it("writes block_pause and block_resume events when pausing and resuming", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("pause-resume", { mode: "countup" });
    await service.pauseBlock();
    await service.resumeBlock();

    const types = addEventMock.mock.calls.map(
      ([event]) => (event as { type?: string }).type,
    );
    expect(types).toEqual(
      expect.arrayContaining(["block_start", "block_pause", "block_resume"]),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "block_pause",
        content: expect.stringContaining("pause-resume"),
      }),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "block_resume",
        content: expect.stringContaining("pause-resume"),
      }),
    );
  });

  it("does not write duplicate pause events when pausing an already paused block", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("idempotent-pause", { mode: "countup" });
    await service.pauseBlock();
    await service.pauseBlock();

    const pauseCalls = addEventMock.mock.calls.filter(
      ([event]) => (event as { type?: string }).type === "block_pause",
    );
    expect(pauseCalls).toHaveLength(1);
  });

  it("blocks pause/resume once block is in feedback stage and does not emit extra events", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("no-rewind", { mode: "countup" });
    await service.markEnding();
    await service.pauseBlock();
    await service.resumeBlock();

    const types = addEventMock.mock.calls.map(
      ([event]) => (event as { type?: string }).type,
    );
    expect(types).toEqual(expect.arrayContaining(["block_start", "block_end"]));
    expect(types).not.toContain("block_pause");
    expect(types).not.toContain("block_resume");

    const active = await service.loadActiveBlock();
    expect(active?.phase).toBe("feedback_in_progress");
    expect(active?.actionEndedAt).toBeTypeOf("number");
    expect(active?.paused).toBe(false);
  });

  it("does not start a new block when an active block exists", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const first = await service.startBlock("first", { mode: "countup" });
    await service.pauseBlock();

    const second = await service.startBlock("second", { mode: "countup" });

    expect(second.startId).toBe(first.startId);
    expect(second.name).toBe(first.name);

    const startCalls = addEventMock.mock.calls.filter(
      ([event]) => (event as { type?: string }).type === "block_start",
    );
    expect(startCalls).toHaveLength(1);
  });

  it("does not write duplicate block_end event when markEnding is called repeatedly", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock("idempotent-ending", { mode: "countup" });
    await service.markEnding();
    await service.markEnding();

    const endCalls = addEventMock.mock.calls.filter(
      ([event]) => (event as { type?: string }).type === "block_end",
    );
    expect(endCalls).toHaveLength(1);
  });

  it("keeps terminal marker for sync but exposes no active block after feedback submitted", async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const first = await service.startBlock("terminal-marker", {
      mode: "countup",
    });
    await service.markEnding();
    const completed = await service.endBlock("done once");
    const repeated = await service.endBlock("done twice");

    const feedbackCalls = addEventMock.mock.calls.filter(
      ([event]) => (event as { type?: string }).type === "block_feedback",
    );

    expect(completed?.startId).toBe(first.startId);
    expect(repeated).toBeNull();
    expect(feedbackCalls).toHaveLength(1);
    expect(await service.loadActiveBlock()).toBeNull();

    const restarted = await service.startBlock("after-terminal", {
      mode: "countup",
    });
    expect(restarted.startId).not.toBe(first.startId);
  });

  it("stubs fetch by default so endBlock tests never hit live runtime（默认拦截网络避免污染真实 RT）", async () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(true);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("default-fetch-guard", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && networkMocks.fetch.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const embeddedPort = DEFAULT_EMBEDDED_RUNTIME_PORT;
    const embeddedHost = resolveLocalServiceHost(
      window.location.hostname || "localhost",
    );
    expect(networkMocks.fetch).toHaveBeenCalledWith(
      `http://${embeddedHost}:${embeddedPort}/signals/publish`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("publishes timeblock.completed to embedded RT default port（发布到内嵌 RT 默认端口）", async () => {
    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-1" }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("publish-rt", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && networkMocks.fetch.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(networkMocks.fetch).toHaveBeenCalled();
    const embeddedPort = DEFAULT_EMBEDDED_RUNTIME_PORT;
    const embeddedHost = resolveLocalServiceHost(
      window.location.hostname || "localhost",
    );
    expect(networkMocks.fetch).toHaveBeenCalledWith(
      `http://${embeddedHost}:${embeddedPort}/signals/publish`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses signal_publish_fast in tauri when ending block（Tauri 环境走快速信号发布）", async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      accepted: true,
      event_id: "evt-fast-timeblock-1",
    });

    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        event_id: "evt-http-should-not-run",
      }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("publish-fast-tauri", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && tauriMocks.invoke.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(tauriMocks.invoke).toHaveBeenCalledWith("signal_publish_fast", {
      request: expect.objectContaining({
        topic: "timeblock.completed",
        source: "frontend:timeblock-service",
      }),
    });
    expect(networkMocks.fetch).not.toHaveBeenCalled();
  });

  it("publishes to external runtime after target switch（切到外部后发布到外部 RT）", async () => {
    window.localStorage.setItem("exomind:runtimeTargetMode", "external");
    window.localStorage.setItem(
      "exomind:runtimeExternalAddress",
      "127.0.0.1:1949",
    );

    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-2" }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("publish-external-rt", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && networkMocks.fetch.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(networkMocks.fetch).toHaveBeenCalled();
    expect(networkMocks.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:1949/signals/publish",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("publishes stable trace_id for timeblock.completed（时间块信号带稳定 trace_id）", async () => {
    window.localStorage.setItem("exomind:runtimeTargetMode", "external");
    window.localStorage.setItem(
      "exomind:runtimeExternalAddress",
      "127.0.0.1:1949",
    );

    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-trace-1" }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });

    const service = new TimeBlockServiceImpl(env as never);
    const started = await service.startBlock("trace-block", {
      mode: "countup",
    });
    await service.markEnding();
    const completed = await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && networkMocks.fetch.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(completed).not.toBeNull();
    const [, requestInit] = networkMocks.fetch.mock.calls.at(-1) ?? [];
    const body = JSON.parse(String(requestInit?.body ?? "{}")) as {
      trace_id?: string;
    };
    expect(body.trace_id).toBe(
      `timeblock:${started.startId}:${completed?.endTime}`,
    );
  });

  it("publishes the most recent 20 events as context for timeblock.completed（recentEvents 取最新 20 条）", async () => {
    window.localStorage.setItem("exomind:runtimeTargetMode", "external");
    window.localStorage.setItem(
      "exomind:runtimeExternalAddress",
      "127.0.0.1:1949",
    );

    const env = createMemoryEnv();
    // loadEvents() returns events newest-first. Provide 25 events sorted descending
    // so slice(0, 20) yields event-25..event-6 as the test expects.
    const seededEvents = Array.from({ length: 25 }, (_, index) => ({
      id: `event-${25 - index}`,
      content: `event-${25 - index}`,
      timestamp: 25 - index,
      tags: [],
      metadata: {},
    }));
    loadEventsMock.mockResolvedValue(seededEvents);

    networkMocks.fetch.mockReset();
    networkMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: "evt-recent-20" }),
    });

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock("recent-events", { mode: "countup" });
    await service.markEnding();
    await service.endBlock("done");

    for (
      let i = 0;
      i < 20 && networkMocks.fetch.mock.calls.length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const [, requestInit] = networkMocks.fetch.mock.calls.at(-1) ?? [];
    const body = JSON.parse(String(requestInit?.body ?? "{}")) as {
      payload?: { recentEvents?: Array<{ text: string; ts: number }> };
    };

    expect(loadEventsMock).toHaveBeenCalledWith({ limit: 20 });
    expect(body.payload?.recentEvents).toHaveLength(20);
    expect(body.payload?.recentEvents?.map((event) => event.text)).toEqual([
      "event-25",
      "event-24",
      "event-23",
      "event-22",
      "event-21",
      "event-20",
      "event-19",
      "event-18",
      "event-17",
      "event-16",
      "event-15",
      "event-14",
      "event-13",
      "event-12",
      "event-11",
      "event-10",
      "event-9",
      "event-8",
      "event-7",
      "event-6",
    ]);
  });

  describe("#418 multi-task support", () => {
    it("startBlock accepts taskIds object", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      const block = await service.startBlock(
        "Test",
        { mode: "countup" },
        undefined,
        { taskIds: ["t1", "t2"] },
      );

      expect(block.taskIds).toEqual(["t1", "t2"]);
      expect(block.taskAssociationLog).toHaveLength(2);
      expect(block.taskId).toBeUndefined();
    });

    it("startBlock with legacy string taskId still works", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      const block = await service.startBlock(
        "Test",
        { mode: "countup" },
        undefined,
        "single-task",
      );

      expect(block.taskIds).toEqual(["single-task"]);
      expect(block.taskAssociationLog).toEqual([
        expect.objectContaining({
          taskId: "single-task",
          action: "associated",
          source: "block_start",
        }),
      ]);
    });

    it("updateActiveBlock returns null when no active block exists", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      await expect(
        service.updateActiveBlock({ taskIds: ["t1"] }),
      ).resolves.toBeNull();
    });

    it("updateActiveBlock patches taskIds on running block", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      await service.startBlock("Test", { mode: "countup" });
      const updated = await service.updateActiveBlock({ taskIds: ["t1"] });

      expect(updated?.taskIds).toEqual(["t1"]);
      expect((await service.loadActiveBlock())?.taskIds).toEqual(["t1"]);
    });

    it("updateActiveBlock returns null for feedback-submitted block and does not resurrect it", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      await service.startBlock("Test", { mode: "countup" });
      await service.markEnding();
      await service.endBlock("done");

      await expect(
        service.updateActiveBlock({ taskIds: ["t1"] }),
      ).resolves.toBeNull();
      await expect(service.loadActiveBlock()).resolves.toBeNull();
    });

    it("endBlock writes taskIds and taskStatusOutcomes to completed block", async () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      await service.startBlock("Test", { mode: "countup" }, undefined, {
        taskIds: ["t1", "t2"],
      });
      await service.markEnding();
      const completed = await service.endBlock("done", {
        taskStatusOutcomes: {
          t1: "completed",
          t2: "continue",
        },
        taskTitles: {
          t1: "Task 1",
          t2: "Task 2",
        },
      });

      expect(completed).toEqual(
        expect.objectContaining({
          taskIds: ["t1", "t2"],
          taskStatusOutcomes: {
            t1: "completed",
            t2: "continue",
          },
        }),
      );
      expect(completed?.taskAssociationLog).toHaveLength(2);
    });

    it("buildFeedbackReport includes task status section", () => {
      const env = createMemoryEnv();
      const service = new TimeBlockServiceImpl(env as never);

      const report = (
        service as unknown as {
          buildFeedbackReport: (input: Record<string, unknown>) => string;
        }
      ).buildFeedbackReport({
        timeBlockName: "Test Block",
        feedbackText: "done",
        hasFeedback: true,
        feedbackPreferences: {
          timingInfoEnabled: false,
          statisticsEnabled: false,
          quickFeedbackEnabled: true,
        },
        feedbackDurationMs: 1_000,
        pausedDurationMs: 0,
        workDurationMs: 5_000,
        totalDurationMs: 6_000,
        expectedDurationMs: null,
        expectedEndAt: null,
        actionStartAt: 1_700_000_000_000,
        actionEndedAt: 1_700_000_005_000,
        submittedAt: 1_700_000_006_000,
        taskStatusOutcomes: {
          t1: "completed",
          t2: "continue",
        },
        taskTitles: {
          t1: "Task 1",
          t2: "Task 2",
        },
      });

      expect(report).toContain("### 任务状态");
      expect(report).toContain("- Task 1：已完成");
      expect(report).toContain("- Task 2：将继续");
    });
  });
});
