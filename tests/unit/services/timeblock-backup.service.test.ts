import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockBackupServiceImpl } from '@/lib/services/timeblock-backup.service';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';

function activateProfileScope(): string {
  const profile = createLocalProfile({
    slug: 'exomind',
    displayName: 'Hailay',
  });
  setProfileSession({
    version: 1,
    activeProfileId: profile.profileId,
    unlockedProfileIds: [profile.profileId],
  });
  return profile.profileId;
}

describe('TimeBlockBackupService（时间块备份服务）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads backend diagnostics from RT status route', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        backend: 'rt-sqlite',
        supports_json_backup: true,
        supports_sqlite_snapshot: true,
      }),
    }));

    const service = new TimeBlockBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await service.getBackendStatus();

    expect(result).toEqual({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/backend/status');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit.method ?? 'GET').toBe('GET');
  });

  it('exports timeblocks as JSON backup', async () => {
    const profileId = activateProfileScope();
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
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/backup/json');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('imports timeblocks from JSON with explicit strategy', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        imported: 1,
        skipped: 0,
        total: 1,
        active_block_updated: true,
      }),
    }));

    const service = new TimeBlockBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await service.importTimeBlocksFromJson(
      JSON.stringify({
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
            taskIds: [],
            taskAssociationLog: [],
          },
        ],
        active_block: null,
      }),
      'merge',
    );

    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      total: 1,
      activeBlockUpdated: true,
    });
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/import/json');
    expect(url.searchParams.get('strategy')).toBe('merge');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(String(requestInit.body))).toEqual({
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
          taskIds: [],
          taskAssociationLog: [],
        },
      ],
      active_block: null,
    });
  });

  it('exports timeblocks as SQLite snapshot and imports it back', async () => {
    const profileId = activateProfileScope();
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
    const url = new URL(importUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/import/sqlite');
    expect(url.searchParams.get('strategy')).toBe('overwrite');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(JSON.parse(String(importInit.body))).toEqual({
      content_base64: 'AQID',
    });
  });
});
