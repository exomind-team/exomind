import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEventStorageMock,
  addEventMock,
  getFeedbackPreferencesMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
}));

vi.mock('../../../src/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: getFeedbackPreferencesMock,
}));

import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

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
  };
}

describe('TimeBlockServiceImpl', () => {
  beforeEach(() => {
    window.localStorage.clear();
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue(createStorage());
    getFeedbackPreferencesMock.mockReset();
    getFeedbackPreferencesMock.mockReturnValue({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes countdown blocks with remaining milliseconds from minutes', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const block = await service.startBlock('deep work', { mode: 'countdown', minutes: 25 });
    const stored = await service.loadActiveBlock();

    expect(block.elapsed).toBe(25 * 60 * 1000);
    expect(block.targetMinutes).toBe(25);
    expect(stored?.elapsed).toBeLessThanOrEqual(25 * 60 * 1000);
    expect(stored?.elapsed).toBeGreaterThanOrEqual(25 * 60 * 1000 - 2000);
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_start' }));
  });

  it('writes block_feedback event when ending with feedback', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('write tests', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock('felt good');

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_end' }));
    expect(feedbackCall).toEqual(expect.objectContaining({
      type: 'block_feedback',
      content: expect.stringContaining('预期时长：**`∞`**'),
      metadata: expect.objectContaining({
        expectedDurationMs: null,
      }),
    }));
    expect((feedbackCall as { content: string }).content).toContain('### 快速反馈');
    expect((feedbackCall as { content: string }).content).toContain('反馈状态：**`已填写`**');
    expect((feedbackCall as { content: string }).content).toContain('预期差异：**`无预期（正计时）`**');
    expect((feedbackCall as { content: string }).content).toContain('预期结束于：`∞`');
    expect((feedbackCall as { content: string }).content).not.toContain('超时投入');
    expect((feedbackCall as { content: string }).content).toContain('---');
    expect((feedbackCall as { content: string }).content).toContain('felt good');
  });

  it('writes block_feedback event when ending without feedback', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('write tests', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock();

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect(feedbackCall).toEqual(expect.objectContaining({
      type: 'block_feedback',
      metadata: expect.objectContaining({
        expectedDurationMs: null,
      }),
    }));
    expect((feedbackCall as { content: string }).content).toContain('### 快速反馈');
    expect((feedbackCall as { content: string }).content).toContain('反馈状态：**`未填写`**');
    expect((feedbackCall as { content: string }).content).toContain('预期差异：**`无预期（正计时）`**');
    expect((feedbackCall as { content: string }).content).toContain('预期时长：**`∞`**');
    expect((feedbackCall as { content: string }).content).not.toContain('超时投入');
    expect((feedbackCall as { content: string }).content).not.toContain('---');
    expect((feedbackCall as { content: string }).content).not.toContain('（未填写）');
  });

  it('stores countdown expected duration in metadata and reports overtime based on workDuration', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-13T08:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('focus countdown', { mode: 'countdown', minutes: 1 });

    vi.setSystemTime(new Date(base.getTime() + 90_000));
    await service.markEnding();

    vi.setSystemTime(new Date(base.getTime() + 95_000));
    await service.endBlock('overtime happened');

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect(feedbackCall).toEqual(expect.objectContaining({
      type: 'block_feedback',
      metadata: expect.objectContaining({
        expectedDurationMs: 60_000,
        workDurationMs: 90_000,
      }),
    }));
    expect((feedbackCall as { content: string }).content).toContain('预期结束于：`');
    expect((feedbackCall as { content: string }).content).not.toContain('预期结束于：`∞`');
    expect((feedbackCall as { content: string }).content).toContain('预期时长：**`01:00`**');
    expect((feedbackCall as { content: string }).content).toContain('超时投入：**`00:30`**');
    expect((feedbackCall as { content: string }).content).toContain('预期差异：**`🕒工作超时00:30`**');
  });

  it('reports early finish diff when action ends before expected end', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-13T09:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('finish early', { mode: 'countdown', minutes: 1 });

    vi.setSystemTime(new Date(base.getTime() + 30_000));
    await service.markEnding();
    vi.setSystemTime(new Date(base.getTime() + 33_000));
    await service.endBlock('done');

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect((feedbackCall as { content: string }).content).toContain('预期差异：**`🚀提前00:30完成`**');
  });

  it('reports delayed end diff when action ends late but work is still below expected duration', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-13T10:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('late but within work', { mode: 'countdown', minutes: 1 });

    vi.setSystemTime(new Date(base.getTime() + 20_000));
    await service.pauseBlock();
    vi.setSystemTime(new Date(base.getTime() + 90_000));
    await service.markEnding();
    vi.setSystemTime(new Date(base.getTime() + 95_000));
    await service.endBlock('done');

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect((feedbackCall as { content: string }).content).toContain(
      '预期差异：**`✨时间块已完成，超出预期结束时间00:30`**',
    );
  });

  it('accumulates paused duration and stores durations in feedback metadata', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-11T08:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('focus', { mode: 'countup' });

    vi.setSystemTime(new Date(base.getTime() + 10_000));
    await service.pauseBlock();

    vi.setSystemTime(new Date(base.getTime() + 15_000));
    await service.resumeBlock();

    vi.setSystemTime(new Date(base.getTime() + 35_000));
    await service.markEnding();

    vi.setSystemTime(new Date(base.getTime() + 42_000));
    await service.endBlock('done');

    const feedbackCall = addEventMock.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'block_feedback');

    expect(feedbackCall).toBeTruthy();
    expect(feedbackCall).toEqual(expect.objectContaining({
      type: 'block_feedback',
      metadata: expect.objectContaining({
        actionDurationMs: 35_000,
        feedbackDurationMs: 7_000,
        pausedDurationMs: 5_000,
        workDurationMs: 30_000,
        totalDurationMs: 42_000,
        expectedDurationMs: null,
      }),
    }));
  });

  it('resolves EventStorage at write time so user switches do not write to stale storage', async () => {
    const env = createMemoryEnv();
    const startAddEventMock = vi.fn();
    const switchedUserAddEventMock = vi.fn();

    getEventStorageMock
      .mockReturnValueOnce(createStorage(startAddEventMock))
      .mockReturnValueOnce(createStorage(switchedUserAddEventMock))
      .mockReturnValueOnce(createStorage(switchedUserAddEventMock));

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock('focus', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock('done');

    expect(getEventStorageMock).toHaveBeenCalledTimes(3);
    expect(startAddEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_start' }));
    expect(switchedUserAddEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_end' }));
    expect(switchedUserAddEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_feedback',
      content: expect.stringContaining('done'),
    }));
  });

  it('recalculates elapsed time on load for running blocks', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-11T08:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('focus', { mode: 'countup' });

    vi.setSystemTime(new Date(base.getTime() + 5000));
    const active = await service.loadActiveBlock();

    expect(active?.paused).toBe(false);
    expect(active?.elapsed).toBeGreaterThanOrEqual(5000);
  });

  it('keeps elapsed stable while paused even after time passes', async () => {
    vi.useFakeTimers();
    const base = new Date('2026-02-11T09:00:00.000Z');
    vi.setSystemTime(base);

    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('pause-check', { mode: 'countup' });

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

  it('writes block_pause and block_resume events when pausing and resuming', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('pause-resume', { mode: 'countup' });
    await service.pauseBlock();
    await service.resumeBlock();

    const types = addEventMock.mock.calls.map(([event]) => (event as { type?: string }).type);
    expect(types).toEqual(expect.arrayContaining(['block_start', 'block_pause', 'block_resume']));
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_pause',
      content: expect.stringContaining('pause-resume'),
    }));
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_resume',
      content: expect.stringContaining('pause-resume'),
    }));
  });

  it('does not write duplicate pause events when pausing an already paused block', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('idempotent-pause', { mode: 'countup' });
    await service.pauseBlock();
    await service.pauseBlock();

    const pauseCalls = addEventMock.mock.calls.filter(([event]) => (event as { type?: string }).type === 'block_pause');
    expect(pauseCalls).toHaveLength(1);
  });

  it('blocks pause/resume once block is in feedback stage and does not emit extra events', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('no-rewind', { mode: 'countup' });
    await service.markEnding();
    await service.pauseBlock();
    await service.resumeBlock();

    const types = addEventMock.mock.calls.map(([event]) => (event as { type?: string }).type);
    expect(types).toEqual(expect.arrayContaining(['block_start', 'block_end']));
    expect(types).not.toContain('block_pause');
    expect(types).not.toContain('block_resume');

    const active = await service.loadActiveBlock();
    expect(active?.phase).toBe('feedback_in_progress');
    expect(active?.actionEndedAt).toBeTypeOf('number');
    expect(active?.paused).toBe(false);
  });

  it('does not start a new block when an active block exists', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const first = await service.startBlock('first', { mode: 'countup' });
    await service.pauseBlock();

    const second = await service.startBlock('second', { mode: 'countup' });

    expect(second.startId).toBe(first.startId);
    expect(second.name).toBe(first.name);

    const startCalls = addEventMock.mock.calls.filter(([event]) => (event as { type?: string }).type === 'block_start');
    expect(startCalls).toHaveLength(1);
  });

  it('does not write duplicate block_end event when markEnding is called repeatedly', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    await service.startBlock('idempotent-ending', { mode: 'countup' });
    await service.markEnding();
    await service.markEnding();

    const endCalls = addEventMock.mock.calls.filter(([event]) => (event as { type?: string }).type === 'block_end');
    expect(endCalls).toHaveLength(1);
  });

  it('keeps terminal marker for sync but exposes no active block after feedback submitted', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const first = await service.startBlock('terminal-marker', { mode: 'countup' });
    await service.markEnding();
    const completed = await service.endBlock('done once');
    const repeated = await service.endBlock('done twice');

    const feedbackCalls = addEventMock.mock.calls.filter(([event]) => (event as { type?: string }).type === 'block_feedback');

    expect(completed?.startId).toBe(first.startId);
    expect(repeated).toBeNull();
    expect(feedbackCalls).toHaveLength(1);
    expect(await service.loadActiveBlock()).toBeNull();

    const restarted = await service.startBlock('after-terminal', { mode: 'countup' });
    expect(restarted.startId).not.toBe(first.startId);
  });

  it('publishes timeblock.completed to embedded RT on port 4077（发布到内嵌 RT 4077）', async () => {
    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: 'evt-1' }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock('publish-rt', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock('done');

    for (let i = 0; i < 20 && fetchSpy.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4077/signals/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('publishes to external runtime after target switch（切到外部后发布到外部 RT）', async () => {
    window.localStorage.setItem('exomind:runtimeTargetMode', 'external');
    window.localStorage.setItem('exomind:runtimeExternalAddress', '127.0.0.1:1949');

    const env = createMemoryEnv();
    const addEvent = vi.fn();
    const getEvents = vi.fn().mockResolvedValue([]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: 'evt-2' }),
    });

    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent,
      getEvents,
    });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const service = new TimeBlockServiceImpl(env as never);
    await service.startBlock('publish-external-rt', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock('done');

    for (let i = 0; i < 20 && fetchSpy.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/signals/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
