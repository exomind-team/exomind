import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLogBackupServiceImpl } from '@/lib/services/eventlog-backup.service';
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

describe('EventLogBackupService（事件日志备份服务）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('exports eventlog JSON backup under active profile scope（导出带当前档案作用域）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: 1,
        exportedAt: '2026-03-12T00:00:00.000Z',
        events: [
          {
            id: 'event-1',
            timestamp: 1700000000000,
            content: 'hello',
            tags: ['note'],
          },
        ],
      }),
    }));

    const service = new EventLogBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await service.exportEventsAsJson();

    expect(result.eventCount).toBe(1);
    expect(result.content).toContain('"events"');
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/eventlog/backup/json');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('imports SQLite snapshot under active profile scope（导入带当前档案作用域）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        imported: 3,
        skipped: 0,
        total: 3,
      }),
    }));

    const service = new EventLogBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await service.importEventsFromSqliteSnapshot(new Uint8Array([1, 2, 3]), 'overwrite');

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/eventlog/import/sqlite');
    expect(url.searchParams.get('strategy')).toBe('overwrite');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(JSON.parse(String(requestInit.body))).toEqual({
      content_base64: 'AQID',
    });
  });
});
