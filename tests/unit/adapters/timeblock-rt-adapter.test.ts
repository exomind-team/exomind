import { describe, expect, it, vi } from 'vitest';
import { TimeBlockRtAdapter } from '@/lib/adapters/timeblock-rt-adapter';

describe('TimeBlockRtAdapter（RT 时间块适配器）', () => {
  it('lists completed timeblocks from runtime', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'tb-1',
          name: 'Focus',
          startId: 'start-1',
          endId: 'end-1',
          note: 'done',
          tags: ['block_feedback'],
          startTime: 1700000000000,
          endTime: 1700000060000,
        },
      ]),
    }));

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const blocks = await adapter.listCompletedBlocks();

    expect(blocks).toEqual([
      {
        id: 'tb-1',
        name: 'Focus',
        startId: 'start-1',
        endId: 'end-1',
        note: 'done',
        tags: ['block_feedback'],
        startTime: 1700000000000,
        endTime: 1700000060000,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9124/timeblocks', expect.any(Object));
  });

  it('upserts and clears active block via runtime routes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      });

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.putActiveBlock({
      startId: 'active-1',
      name: 'Deep work',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 300000,
      paused: false,
      startTime: 1700000000000,
    });
    await adapter.deleteActiveBlock();

    const [putUrl, putInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(putUrl).toBe('http://127.0.0.1:9124/timeblocks/active');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(String(putInit.body))).toEqual({
      startId: 'active-1',
      name: 'Deep work',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 300000,
      paused: false,
      startTime: 1700000000000,
    });

    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(deleteUrl).toBe('http://127.0.0.1:9124/timeblocks/active');
    expect(deleteInit.method).toBe('DELETE');
  });
});
