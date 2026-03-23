import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskBackupServiceImpl } from '@/lib/services/task-backup.service';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';

function activateProfileScope(): string {
  const profile = createLocalProfile({
    slug: 'hailay',
    displayName: 'Hailay',
  });
  setProfileSession({
    version: 1,
    activeProfileId: profile.profileId,
    unlockedProfileIds: [profile.profileId],
  });
  return profile.profileId;
}

describe('TaskBackupService（任务备份服务）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('exports task JSON backup under active profile scope（导出带当前档案作用域）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: 1,
        tasks: [
          {
            id: 'task-1',
            title: 'Scoped task',
          },
        ],
      }),
    }));

    const service = new TaskBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await service.exportTasksAsJson();

    expect(result.taskCount).toBe(1);
    expect(result.content).toContain('"tasks"');
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/tasks/backup/json');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('imports SQLite snapshot under active profile scope（导入带当前档案作用域）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        imported: 2,
        skipped: 0,
        total: 2,
      }),
    }));

    const service = new TaskBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await service.importTasksFromSqliteSnapshot(new Uint8Array([1, 2, 3]), 'overwrite');

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/tasks/import/sqlite');
    expect(url.searchParams.get('strategy')).toBe('overwrite');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(JSON.parse(String(requestInit.body))).toEqual({
      content_base64: 'AQID',
    });
  });
});
