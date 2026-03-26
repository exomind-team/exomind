import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';
import { TodayPlannerRtAdapter } from '@/lib/adapters/today-planner-rt-adapter';

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

describe('TodayPlannerRtAdapter（Today Planner RT 适配器）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses /act/today-planner routes with scoped query and expected verbs（走 /act/today-planner 且自动带 profile scope）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: '2026-03-26',
          blocks: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'plan-1',
          date: '2026-03-26',
          type: 'work',
          title: 'Deep Work',
          plannedStartAt: 1774490400000,
          plannedDurationMinutes: 50,
          linkedTaskIds: ['task-a'],
          order: 0,
          createdAt: 1774489000000,
          updatedAt: 1774489000000,
          status: 'pending',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'plan-1',
          date: '2026-03-26',
          type: 'rest',
          title: 'Lunch Reset',
          plannedStartAt: 1774494000000,
          plannedDurationMinutes: 30,
          linkedTaskIds: [],
          order: 0,
          createdAt: 1774489000000,
          updatedAt: 1774489100000,
          status: 'pending',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: '2026-03-26',
          blocks: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          startId: 'active-1',
          name: 'Lunch Reset',
          mode: 'countdown',
          targetMinutes: 30,
          elapsed: 1800000,
          paused: false,
          startTime: 1774494000000,
          taskIds: [],
          taskAssociationLog: [],
          sourcePlannedBlockId: 'plan-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      });

    const adapter = new TodayPlannerRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.getTodayPlanner('2026-03-26');
    await adapter.createPlannedBlock({
      date: '2026-03-26',
      type: 'work',
      title: 'Deep Work',
      plannedStartAt: 1774490400000,
      plannedDurationMinutes: 50,
      linkedTaskIds: ['task-a'],
    });
    await adapter.updatePlannedBlock('plan-1', {
      type: 'rest',
      title: 'Lunch Reset',
      plannedStartAt: 1774494000000,
      plannedDurationMinutes: 30,
      linkedTaskIds: [],
    });
    await adapter.reorderPlannedBlocks('2026-03-26', ['plan-2', 'plan-1']);
    await adapter.startPlannedBlock('plan-1');
    await adapter.deletePlannedBlock('plan-1');

    const [listUrl, listInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const listRequestUrl = new URL(listUrl);
    expect(`${listRequestUrl.origin}${listRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner');
    expect(listRequestUrl.searchParams.get('date')).toBe('2026-03-26');
    expect(listRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(listInit.method).toBe('GET');

    const [createUrl, createInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const createRequestUrl = new URL(createUrl);
    expect(`${createRequestUrl.origin}${createRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/blocks');
    expect(createRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(String(createInit.body))).toEqual({
      date: '2026-03-26',
      type: 'work',
      title: 'Deep Work',
      plannedStartAt: 1774490400000,
      plannedDurationMinutes: 50,
      linkedTaskIds: ['task-a'],
    });

    const [updateUrl, updateInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    const updateRequestUrl = new URL(updateUrl);
    expect(`${updateRequestUrl.origin}${updateRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/blocks/plan-1');
    expect(updateRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(updateInit.method).toBe('PATCH');

    const [reorderUrl, reorderInit] = fetchImpl.mock.calls[3] as [string, RequestInit];
    const reorderRequestUrl = new URL(reorderUrl);
    expect(`${reorderRequestUrl.origin}${reorderRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/blocks/reorder');
    expect(reorderRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(reorderInit.method).toBe('POST');
    expect(JSON.parse(String(reorderInit.body))).toEqual({
      date: '2026-03-26',
      orderedIds: ['plan-2', 'plan-1'],
    });

    const [startUrl, startInit] = fetchImpl.mock.calls[4] as [string, RequestInit];
    const startRequestUrl = new URL(startUrl);
    expect(`${startRequestUrl.origin}${startRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/blocks/plan-1/start');
    expect(startRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(startInit.method).toBe('POST');

    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[5] as [string, RequestInit];
    const deleteRequestUrl = new URL(deleteUrl);
    expect(`${deleteRequestUrl.origin}${deleteRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/blocks/plan-1');
    expect(deleteRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(deleteInit.method).toBe('DELETE');
  });
});
