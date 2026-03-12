import { describe, expect, it, vi } from 'vitest';
import { TimeBlockBackupServiceImpl } from '@/lib/services/timeblock-backup.service';

describe('TimeBlockBackupService（时间块备份服务）', () => {
  it('exports timeblocks as JSON backup', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: 1,
        time_blocks: [
          {
            id: 'tb-1',
            name: 'Focus',
            startId: 'start-1',
            endId: 'end-1',
            tags: ['block_feedback'],
            startTime: 1700000000000,
            endTime: 1700000060000,
          },
        ],
        active_block: null,
      }),
    }));

    const service = new TimeBlockBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await service.exportTimeBlocksAsJson();

    expect(result.timeBlockCount).toBe(1);
    expect(result.content).toContain('"time_blocks"');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9124/timeblocks/backup/json', expect.any(Object));
  });

  it('exports timeblocks as SQLite snapshot and imports it back', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          version: 1,
          file_name: 'exomind-timeblocks.sqlite',
          content_base64: 'AQID',
          timeblock_count: 2,
          active_block_present: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          imported: 2,
          skipped: 0,
          total: 2,
          active_block_updated: true,
        }),
      });

    const service = new TimeBlockBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const exportResult = await service.exportTimeBlocksAsSqliteSnapshot();
    expect(Array.from(exportResult.bytes)).toEqual([1, 2, 3]);

    const importResult = await service.importTimeBlocksFromSqliteSnapshot(new Uint8Array([1, 2, 3]), 'overwrite');
    expect(importResult).toEqual({
      imported: 2,
      skipped: 0,
      total: 2,
      activeBlockUpdated: true,
    });

    const [importUrl, importInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(importUrl).toBe('http://127.0.0.1:9124/timeblocks/import/sqlite?strategy=overwrite');
    expect(JSON.parse(String(importInit.body))).toEqual({
      content_base64: 'AQID',
    });
  });
});
