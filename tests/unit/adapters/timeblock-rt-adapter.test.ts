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

  it('posts gap backfill to runtime', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ inserted: 2 }),
      });

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await adapter.rtBackfillGapBlocks();

    expect(result).toEqual({ inserted: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/backfill-gaps');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(String(requestInit.body))).toEqual({});
  });

  it('uses dedicated lifecycle, describe, and replication routes with scoped query（走现行时间块生命周期/描述/复制路由）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          completed: null,
          active: {
            startId: 'active-1',
            name: 'Deep work',
            mode: 'countdown',
            targetMinutes: 25,
            elapsed: 0,
            paused: false,
            startTime: 1700000000000,
            phase: 'running',
            version: 1,
            taskIds: ['task-1'],
            taskAssociationLog: [],
            sourcePlannedBlockId: 'plan-1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'stopped' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          completed: {
            id: 'active-1',
            name: 'Deep work',
            startId: 'active-1',
            endId: 'end-1',
            note: 'done',
            tags: ['block_feedback'],
            startTime: 1700000000000,
            endTime: 1700001500000,
            taskIds: ['task-1'],
            taskAssociationLog: [],
            sourcePlannedBlockId: 'plan-1',
          },
          active: {
            startId: 'gap-1',
            name: '',
            mode: 'countup',
            blockType: 'gap',
            elapsed: 0,
            paused: false,
            startTime: 1700001500000,
            taskIds: [],
            taskAssociationLog: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'paused' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'running' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ updated: 'active', blockId: 'active-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ updated: 'completed', blockId: 'tb-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'inserted' }),
      });

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.rtStartBlock({
      name: 'Deep work',
      mode: 'countdown',
      targetMinutes: 25,
      taskIds: ['task-1'],
      sourcePlannedBlockId: 'plan-1',
    });
    await adapter.rtStopBlock();
    await adapter.rtEndBlock({
      feedback: 'done',
      taskStatusOutcomes: { 'task-1': 'completed' },
    });
    await adapter.rtPauseBlock();
    await adapter.rtResumeBlock();
    await adapter.rtDescribeBlock({ name: 'Renamed block' });
    await adapter.rtDescribeBlockById('tb-1', { note: 'retrospective' });
    const replication = await adapter.applyReplicationCompletedBlock({
      id: 'tb-1',
      name: 'Deep work',
      startId: 'active-1',
      endId: 'end-1',
      note: 'done',
      tags: ['block_feedback'],
      startTime: 1700000000000,
      endTime: 1700001500000,
      taskIds: ['task-1'],
      taskAssociationLog: [],
      sourcePlannedBlockId: 'plan-1',
    });

    expect(replication).toBe('inserted');

    const [startUrl, startInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const startRequestUrl = new URL(startUrl);
    expect(`${startRequestUrl.origin}${startRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/start');
    expect(startRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(startInit.method).toBe('POST');
    expect(JSON.parse(String(startInit.body))).toEqual({
      name: 'Deep work',
      mode: 'countdown',
      targetMinutes: 25,
      taskIds: ['task-1'],
      sourcePlannedBlockId: 'plan-1',
    });

    const [stopUrl, stopInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const stopRequestUrl = new URL(stopUrl);
    expect(`${stopRequestUrl.origin}${stopRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/stop');
    expect(stopRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(stopInit.method).toBe('POST');
    expect(JSON.parse(String(stopInit.body))).toEqual({});

    const [endUrl, endInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    const endRequestUrl = new URL(endUrl);
    expect(`${endRequestUrl.origin}${endRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/end');
    expect(endRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(endInit.method).toBe('POST');
    expect(JSON.parse(String(endInit.body))).toEqual({
      feedback: 'done',
      taskStatusOutcomes: { 'task-1': 'completed' },
    });

    const [pauseUrl, pauseInit] = fetchImpl.mock.calls[3] as [string, RequestInit];
    const pauseRequestUrl = new URL(pauseUrl);
    expect(`${pauseRequestUrl.origin}${pauseRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/pause');
    expect(pauseRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(pauseInit.method).toBe('POST');

    const [resumeUrl, resumeInit] = fetchImpl.mock.calls[4] as [string, RequestInit];
    const resumeRequestUrl = new URL(resumeUrl);
    expect(`${resumeRequestUrl.origin}${resumeRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/resume');
    expect(resumeRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(resumeInit.method).toBe('POST');

    const [describeUrl, describeInit] = fetchImpl.mock.calls[5] as [string, RequestInit];
    const describeRequestUrl = new URL(describeUrl);
    expect(`${describeRequestUrl.origin}${describeRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/describe');
    expect(describeRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(describeInit.method).toBe('POST');
    expect(JSON.parse(String(describeInit.body))).toEqual({ name: 'Renamed block' });

    const [describeByIdUrl, describeByIdInit] = fetchImpl.mock.calls[6] as [string, RequestInit];
    const describeByIdRequestUrl = new URL(describeByIdUrl);
    expect(`${describeByIdRequestUrl.origin}${describeByIdRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/tb-1/describe');
    expect(describeByIdRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(describeByIdInit.method).toBe('POST');
    expect(JSON.parse(String(describeByIdInit.body))).toEqual({ note: 'retrospective' });

    const [replicationUrl, replicationInit] = fetchImpl.mock.calls[7] as [string, RequestInit];
    const replicationRequestUrl = new URL(replicationUrl);
    expect(`${replicationRequestUrl.origin}${replicationRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/replication/completed');
    expect(replicationRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(replicationInit.method).toBe('POST');
    expect(JSON.parse(String(replicationInit.body))).toEqual({
      block: {
        id: 'tb-1',
        name: 'Deep work',
        startId: 'active-1',
        endId: 'end-1',
        note: 'done',
        tags: ['block_feedback'],
        startTime: 1700000000000,
        endTime: 1700001500000,
        taskIds: ['task-1'],
        taskAssociationLog: [],
        sourcePlannedBlockId: 'plan-1',
      },
    });
  });

  it('patches active block task links via PATCH', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        startId: 'active-1',
        name: 'Deep work',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 300000,
        paused: false,
        startTime: 1700000000000,
        phase: 'running',
        version: 2,
        lastTransitionAt: 1700000010000,
        updatedAt: 1700000010000,
        taskIds: ['task-1', 'task-2'],
        taskAssociationLog: [
          {
            blockId: 'active-1',
            taskId: 'task-2',
            action: 'associated',
            timestamp: 1700000010000,
            source: 'manual',
          },
        ],
      }),
    }));

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const result = await adapter.rtPatchActiveBlockTasks({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [
        {
          blockId: 'active-1',
          taskId: 'task-2',
          action: 'associated',
          timestamp: 1700000010000,
          source: 'manual',
        },
      ],
    });

    expect(result).toMatchObject({
      startId: 'active-1',
      taskIds: ['task-1', 'task-2'],
      version: 2,
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/timeblocks/active/tasks');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit.method).toBe('PATCH');
    expect(JSON.parse(String(requestInit.body))).toEqual({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [
        {
          blockId: 'active-1',
          taskId: 'task-2',
          action: 'associated',
          timestamp: 1700000010000,
          source: 'manual',
        },
      ],
    });
  });

  it('returns null when patching active block tasks hits 409', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({}),
      text: async () => 'conflict',
    }));

    const adapter = new TimeBlockRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await expect(adapter.rtPatchActiveBlockTasks({
      taskIds: ['task-1'],
      taskAssociationLog: [],
    })).resolves.toBeNull();
  });
});
