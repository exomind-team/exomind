import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('initializes countdown blocks with remaining milliseconds from minutes', async () => {
    const env = createMemoryEnv();
    const service = new TimeBlockServiceImpl(env as never);

    const block = await service.startBlock('deep work', { mode: 'countdown', minutes: 25 });
    const stored = await service.loadActiveBlock();

    expect(block.elapsed).toBe(25 * 60 * 1000);
    expect(block.targetMinutes).toBe(25);
    expect(stored?.elapsed).toBe(25 * 60 * 1000);
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
});
