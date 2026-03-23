import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRtAdapter } from '@/lib/adapters/task-rt-adapter';
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

describe('TaskRtAdapter（RT 任务适配器）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps runtime task payload to frontend TaskNode', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'task-1',
          title: 'RT Task',
          description: 'from runtime',
          done_condition: 'ship feature',
          status: 'pending',
          priority: 'high',
          tags: ['rt'],
          source: 'runtime:test',
          parent_id: 'parent-1',
          depends_on: [{ task_id: 'dep-1', type: 'hard' }],
          due_at: 1700000000000,
          estimated_minutes: 45,
          time_block_ids: ['block-1'],
          created_at: 1700000000001,
          updated_at: 1700000000002,
          completed_at: null,
        },
      ]),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const tasks = await adapter.listTasks(true);

    expect(tasks).toEqual([
      {
        id: 'task-1',
        title: 'RT Task',
        description: 'from runtime',
        doneCondition: 'ship feature',
        status: 'pending',
        priority: 'high',
        tags: ['rt'],
        source: 'runtime:test',
        parentId: 'parent-1',
        dependsOn: [{ taskId: 'dep-1', type: 'hard' }],
        dueAt: 1700000000000,
        estimatedMinutes: 45,
        timeBlockIds: ['block-1'],
        createdAt: 1700000000001,
        updatedAt: 1700000000002,
      },
    ]);
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/tasks');
    expect(url.searchParams.get('user_id')).toBe(profileId);
  });

  it('serializes frontend task updates to runtime payload', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'task-1',
        title: 'Updated Task',
        description: 'from runtime',
        done_condition: 'ship feature',
        status: 'pending',
        priority: 'medium',
        tags: ['rt'],
        source: 'runtime:test',
        parent_id: 'parent-1',
        depends_on: [{ task_id: 'dep-1', type: 'soft' }],
        due_at: null,
        estimated_minutes: 25,
        time_block_ids: ['block-1', 'block-2'],
        created_at: 1700000000001,
        updated_at: 1700000000002,
        completed_at: null,
      }),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    await adapter.updateTask('task-1', {
      doneCondition: 'ship feature',
      dependsOn: [{ taskId: 'dep-1', type: 'soft' }],
      timeBlockIds: ['block-1', 'block-2'],
      estimatedMinutes: 25,
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/tasks/task-1');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit?.method).toBe('PUT');
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      done_condition: 'ship feature',
      depends_on: [{ task_id: 'dep-1', type: 'soft' }],
      time_block_ids: ['block-1', 'block-2'],
      estimated_minutes: 25,
    });
  });

  it('uses the cancel endpoint and normalizes legacy runtime status aliases', async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'task-2',
        title: 'Cancelled Task',
        status: 'abandoned',
        priority: 'medium',
        tags: [],
        depends_on: [],
        time_block_ids: [],
        created_at: 1700000000100,
        updated_at: 1700000000200,
        completed_at: 1700000000200,
      }),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 }),
    });

    const task = await adapter.cancelTask('task-2');

    expect(task?.status).toBe('cancelled');
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:9124/tasks/task-2/cancel');
    expect(url.searchParams.get('user_id')).toBe(profileId);
    expect(requestInit?.method).toBe('POST');
  });
});
