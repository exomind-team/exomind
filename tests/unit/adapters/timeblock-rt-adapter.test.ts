import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockRtAdapter } from '@/lib/adapters/timeblock-rt-adapter';
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

describe('TimeBlockRtAdapter（RT 时间块适配器）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('lists completed timeblocks from runtime', async () => {
    const profileId = activateProfileScope();
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
          taskIds: [],
          taskAssociationLog: [],
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
        taskIds: [],
        taskAssociationLog: [],
      },
    ]);
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('upserts and clears active block via runtime routes', async () => {
    const profileId = activateProfileScope();
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
      taskIds: [],
      taskAssociationLog: [],
    });
    await adapter.deleteActiveBlock();

    const [putUrl, putInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const putRequestUrl = new URL(putUrl);
    expect(`${putRequestUrl.origin}${putRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/active');
    expect(putRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(String(putInit.body))).toEqual({
      startId: 'active-1',
      name: 'Deep work',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 300000,
      paused: false,
      startTime: 1700000000000,
      taskIds: [],
      taskAssociationLog: [],
    });

    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const deleteRequestUrl = new URL(deleteUrl);
    expect(`${deleteRequestUrl.origin}${deleteRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/active');
    expect(deleteRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(deleteInit.method).toBe('DELETE');
  });
});
