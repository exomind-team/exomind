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

  it('uses scheduling-window and segment routes with scoped query and expected verbs（走窗口/片段路由且自动带 profile scope）', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: '2026-03-27',
          windows: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'window-1',
          date: '2026-03-27',
          title: 'Morning Focus',
          plannedStartAt: 1774573600000,
          plannedEndAt: 1774577200000,
          rhythmPreset: {
            key: 'pomodoro_25_5',
            label: '25 / 5',
            workMinutes: 25,
            shortBreakMinutes: 5,
            longBreakMinutes: 20,
            longBreakAfterWorkSegments: 4,
          },
          segments: [],
          createdAt: 1774570000000,
          updatedAt: 1774570000000,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'segment-1',
          windowId: 'window-1',
          kind: 'work',
          title: 'Deep Work A',
          plannedStartAt: 1774573600000,
          plannedEndAt: 1774575100000,
          linkedTaskIds: ['task-a'],
          order: 0,
          createdAt: 1774570000000,
          updatedAt: 1774570100000,
          status: 'pending',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          startId: 'active-1',
          name: 'Deep Work A',
          mode: 'countdown',
          targetMinutes: 25,
          elapsed: 1500000,
          paused: false,
          startTime: 1774573600000,
          taskIds: ['task-a'],
          taskAssociationLog: [],
          sourcePlannedBlockId: 'segment-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'window-1',
          date: '2026-03-27',
          title: 'Morning Focus',
          plannedStartAt: 1774573600000,
          plannedEndAt: 1774577800000,
          rhythmPreset: {
            key: 'pomodoro_25_5',
            label: '25 / 5',
            workMinutes: 25,
            shortBreakMinutes: 5,
            longBreakMinutes: 20,
            longBreakAfterWorkSegments: 4,
          },
          segments: [],
          createdAt: 1774570000000,
          updatedAt: 1774570200000,
        }),
      });

    const adapter = new TodayPlannerRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.getTodayPlanner('2026-03-27');
    await adapter.createSchedulingWindow({
      date: '2026-03-27',
      title: 'Morning Focus',
      plannedStartAt: 1774573600000,
      plannedEndAt: 1774577200000,
      rhythmPresetKey: 'pomodoro_25_5',
    });
    await adapter.updatePlannedSegment('segment-1', {
      title: 'Deep Work A',
      linkedTaskIds: ['task-a'],
    });
    await adapter.startWorkSegment('segment-1');
    await adapter.reflowSchedulingWindow('window-1', {
      anchorSegmentId: 'segment-1',
      actualEndAt: 1774575300000,
    });

    const [listUrl, listInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const listRequestUrl = new URL(listUrl);
    expect(`${listRequestUrl.origin}${listRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner');
    expect(listRequestUrl.searchParams.get('date')).toBe('2026-03-27');
    expect(listRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(listInit.method).toBe('GET');

    const [createUrl, createInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const createRequestUrl = new URL(createUrl);
    expect(`${createRequestUrl.origin}${createRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/windows');
    expect(createRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(String(createInit.body))).toEqual({
      date: '2026-03-27',
      title: 'Morning Focus',
      plannedStartAt: 1774573600000,
      plannedEndAt: 1774577200000,
      rhythmPresetKey: 'pomodoro_25_5',
    });

    const [updateUrl, updateInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    const updateRequestUrl = new URL(updateUrl);
    expect(`${updateRequestUrl.origin}${updateRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/segments/segment-1');
    expect(updateRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(updateInit.method).toBe('PATCH');

    const [startUrl, startInit] = fetchImpl.mock.calls[3] as [string, RequestInit];
    const startRequestUrl = new URL(startUrl);
    expect(`${startRequestUrl.origin}${startRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/segments/segment-1/start');
    expect(startRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(startInit.method).toBe('POST');

    const [reflowUrl, reflowInit] = fetchImpl.mock.calls[4] as [string, RequestInit];
    const reflowRequestUrl = new URL(reflowUrl);
    expect(`${reflowRequestUrl.origin}${reflowRequestUrl.pathname}`).toBe('http://127.0.0.1:9124/act/today-planner/windows/window-1/reflow');
    expect(reflowRequestUrl.searchParams.get('user_id')).toBe(profileId);
    expect(reflowInit.method).toBe('POST');
    expect(JSON.parse(String(reflowInit.body))).toEqual({
      anchorSegmentId: 'segment-1',
      actualEndAt: 1774575300000,
    });
  });
});
