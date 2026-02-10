import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addEventMock, getChangeListenersCountMock } = vi.hoisted(() => ({
  addEventMock: vi.fn(),
  getChangeListenersCountMock: vi.fn(() => 0),
}));

vi.mock('../../../src/lib/storage/event-storage', () => ({
  getEventStorage: vi.fn(() => ({
    addEvent: addEventMock,
    getChangeListenersCount: getChangeListenersCountMock,
  })),
}));

import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

type MemoryEnv = {
  storage: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  data: Map<string, unknown>;
};

function createMemoryEnv(): MemoryEnv {
  const data = new Map<string, unknown>();
  return {
    data,
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

describe('TimeBlockServiceImpl', () => {
  beforeEach(() => {
    addEventMock.mockReset();
    getChangeListenersCountMock.mockReturnValue(0);
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
    await service.endBlock('状态不错');

    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'block_end' }));
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'block_feedback',
      content: '状态不错',
    }));
  });
});
