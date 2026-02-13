import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEventStorageMock,
  addEventMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
}));

vi.mock('../../../src/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
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
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue(createStorage());
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
    await service.endBlock('felt good');

    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_end' }));
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_feedback',
      content: 'felt good',
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
    await service.endBlock('done');

    expect(getEventStorageMock).toHaveBeenCalledTimes(3);
    expect(startAddEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_start' }));
    expect(switchedUserAddEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_end' }));
    expect(switchedUserAddEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_feedback',
      content: 'done',
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
});
