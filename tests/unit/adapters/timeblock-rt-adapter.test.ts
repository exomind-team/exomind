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

  it('upserts active block via PUT and deleteActiveBlock is a no-op', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi
      .fn()
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

    // deleteActiveBlock is deprecated — it only logs a warning, no fetch call
    await adapter.deleteActiveBlock();

    // Only 1 fetch call (the PUT), not 2
    expect(fetchImpl).toHaveBeenCalledTimes(1);

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
  });
});
