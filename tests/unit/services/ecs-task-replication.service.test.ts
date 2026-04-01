import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskNode } from '@/lib/types/task';

const mocks = vi.hoisted(() => ({
  getCurrentProfileOrLegacyIdMock: vi.fn(),
  applyReplicationSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  getCurrentProfileOrLegacyId: mocks.getCurrentProfileOrLegacyIdMock,
}));

vi.mock('@/lib/adapters/task-rt-adapter', () => ({
  TaskRtAdapter: class MockTaskRtAdapter {
    applyReplicationSnapshot = mocks.applyReplicationSnapshotMock;
  },
}));

import {
  projectTaskReplicationUpsert,
  type TaskReplicationUpsertedPayload,
} from '@/lib/services/ecs-task-replication.service';

describe('ecs-task-replication.service', () => {
  const sampleTask: TaskNode = {
    id: 'task-replication-1',
    title: 'Replicated task',
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    timeBlockIds: [],
  };

  beforeEach(() => {
    mocks.getCurrentProfileOrLegacyIdMock.mockReset().mockReturnValue('profile-local');
    mocks.applyReplicationSnapshotMock.mockReset().mockResolvedValue('inserted');
  });

  it('projects replicated task into local RT adapter（把远端任务复制快照投影进本地 RT）', async () => {
    const payload: TaskReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: sampleTask.id,
        updatedAt: sampleTask.updatedAt,
        originHostId: 'desktop-host',
      },
      task: sampleTask,
    };

    await expect(projectTaskReplicationUpsert(payload)).resolves.toBe('inserted');
    expect(mocks.applyReplicationSnapshotMock).toHaveBeenCalledWith(sampleTask, 'desktop-host');
  });

  it('ignores replicated task from another profile scope（不同档案作用域的任务快照不应串档）', async () => {
    const payload: TaskReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-remote',
      cursor: {
        kind: 'task_snapshot',
        taskId: sampleTask.id,
        updatedAt: sampleTask.updatedAt,
        originHostId: 'desktop-host',
      },
      task: sampleTask,
    };

    await expect(projectTaskReplicationUpsert(payload)).resolves.toBe('ignored');
    expect(mocks.applyReplicationSnapshotMock).not.toHaveBeenCalled();
  });

  it('normalizes runtime-shaped replicated task payload before projecting（运行时 snake_case 任务载荷应先正规化再投影）', async () => {
    const runtimeTaskPayload = {
      id: 'task-runtime-shaped',
      title: 'Runtime shaped task',
      description: 'from rust runtime payload',
      status: 'pending',
      priority: 'medium',
      depends_on: [],
      tags: [],
      created_at: 1_700_000_100_000,
      updated_at: 1_700_000_101_000,
      time_block_ids: [],
    };

    const payload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: 'task-runtime-shaped',
        updatedAt: 1_700_000_101_000,
        originHostId: 'android-host',
      },
      task: runtimeTaskPayload,
    } as unknown as TaskReplicationUpsertedPayload;

    await expect(projectTaskReplicationUpsert(payload)).resolves.toBe('inserted');
    expect(mocks.applyReplicationSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-runtime-shaped',
        title: 'Runtime shaped task',
        description: 'from rust runtime payload',
        dependsOn: [],
        tags: [],
        createdAt: 1_700_000_100_000,
        updatedAt: 1_700_000_101_000,
        timeBlockIds: [],
      }),
      'android-host',
    );
  });
});
