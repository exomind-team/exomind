import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskServiceImpl } from '@/lib/services/task.service';
import { TaskTimerServiceImpl } from '@/lib/services/task-timer.service';
import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';
import type { ITaskPort, UpdateTaskInput } from '@/lib/environment/interfaces/task.port';
import type { TaskNode, TaskStatus } from '@/lib/types/task';

const {
  getEventStorageMock,
  addEventMock,
  getFeedbackPreferencesMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: getFeedbackPreferencesMock,
}));

type MemoryEnv = {
  storage: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
};

function createMemoryEnv(): MemoryEnv {
  const data = new Map<string, unknown>();
  return {
    storage: {
      async read<T>(key: string) {
        return (data.has(key) ? data.get(key) : null) as T | null;
      },
      async write(key: string, value: unknown) {
        data.set(key, value);
      },
      async delete(key: string) {
        data.delete(key);
      },
    },
  };
}

function createStorage(addEventImpl = addEventMock) {
  return {
    addEvent: addEventImpl,
    getEvents: vi.fn().mockResolvedValue([]),
  };
}

function makeTask(overrides: Partial<TaskNode>): TaskNode {
  const now = Date.now();
  return {
    id: overrides.id ?? `task-${now}`,
    title: overrides.title ?? '测试任务',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'medium',
    dependsOn: overrides.dependsOn ?? [],
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    description: overrides.description,
    doneCondition: overrides.doneCondition,
    dueAt: overrides.dueAt,
    source: overrides.source,
    parentId: overrides.parentId,
    estimatedMinutes: overrides.estimatedMinutes,
    timeBlockIds: overrides.timeBlockIds,
    completedAt: overrides.completedAt,
  };
}

function createMemoryTaskPort(tasks: TaskNode[]): ITaskPort {
  const store = new Map(tasks.map((task) => [task.id, { ...task }]));

  const applyUpdate = (task: TaskNode, updates: UpdateTaskInput): TaskNode => ({
    ...task,
    ...updates,
    updatedAt: Date.now(),
  });

  return {
    listTasks: vi.fn(async (includeCancelled = false) => (
      [...store.values()].filter((task) => includeCancelled || task.status !== 'cancelled')
    )),
    getTaskById: vi.fn(async (id: string) => store.get(id) ?? null),
    createTask: vi.fn(async (input) => {
      const created = makeTask({
        id: `task-${store.size + 1}`,
        title: input.title,
        description: input.description,
        doneCondition: input.doneCondition,
        priority: input.priority ?? 'medium',
        dueAt: input.dueAt,
        source: input.source,
        parentId: input.parentId,
        tags: input.tags ?? [],
        estimatedMinutes: input.estimatedMinutes,
      });
      store.set(created.id, created);
      return created;
    }),
    updateTask: vi.fn(async (id: string, updates: UpdateTaskInput) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = applyUpdate(existing, updates);
      store.set(id, updated);
      return updated;
    }),
    cancelTask: vi.fn(async (id: string) => {
      const existing = store.get(id);
      if (!existing) return null;
      const cancelled = {
        ...existing,
        status: 'cancelled' as const,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      };
      store.set(id, cancelled);
      return cancelled;
    }),
    transitionTask: vi.fn(async (id: string, to: TaskStatus) => {
      const existing = store.get(id);
      if (!existing) return null;
      const transitioned = {
        ...existing,
        status: to,
        updatedAt: Date.now(),
        completedAt: to === 'completed' || to === 'cancelled' ? Date.now() : existing.completedAt,
      };
      store.set(id, transitioned);
      return transitioned;
    }),
    getAvailableTransitions: vi.fn(async () => []),
  };
}

describe('TimeBlock multi-task association integration（#418 多任务时间块集成）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getFeedbackPreferencesMock.mockReset();
    getEventStorageMock.mockReturnValue(createStorage());
    getFeedbackPreferencesMock.mockReturnValue({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, event_id: 'evt-integration' }),
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps only final associated tasks in completed block and task timeBlockIds（只为结束时仍关联的任务回写）', async () => {
    const taskPort = createMemoryTaskPort([
      makeTask({ id: 'task-1', title: '任务一', status: 'pending' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'suspended' }),
      makeTask({ id: 'task-3', title: '任务三', status: 'pending' }),
    ]);
    const taskService = new TaskServiceImpl({ task: taskPort });
    const timeBlockService = new TimeBlockServiceImpl(createMemoryEnv() as never);
    const taskTimerService = new TaskTimerServiceImpl(taskService, timeBlockService);

    const block = await taskTimerService.startBlockForTasks(['task-1', 'task-2'], { mode: 'countup' });
    expect(block).not.toBeNull();
    expect(block?.taskIds).toEqual(['task-1', 'task-2']);
    expect((await taskService.getTask('task-1'))?.status).toBe('in_progress');
    expect((await taskService.getTask('task-2'))?.status).toBe('in_progress');

    await taskTimerService.removeTaskFromBlock('task-2');
    await taskTimerService.addTaskToBlock('task-3');

    const activeBlock = await timeBlockService.loadActiveBlock();
    expect(activeBlock?.taskIds).toEqual(['task-1', 'task-3']);
    expect(activeBlock?.taskAssociationLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-1', action: 'associated', source: 'block_start' }),
      expect.objectContaining({ taskId: 'task-2', action: 'associated', source: 'block_start' }),
      expect.objectContaining({ taskId: 'task-2', action: 'disassociated', source: 'manual' }),
      expect.objectContaining({ taskId: 'task-3', action: 'associated', source: 'manual' }),
    ]));

    await timeBlockService.markEnding();
    const completedBlock = await timeBlockService.endBlock('完成多任务专注', {
      taskStatusOutcomes: {
        'task-1': 'completed',
        'task-3': 'suspended',
      },
      taskTitles: {
        'task-1': '任务一',
        'task-3': '任务三',
      },
    });

    expect(completedBlock?.taskIds).toEqual(['task-1', 'task-3']);
    expect(completedBlock?.taskStatusOutcomes).toEqual({
      'task-1': 'completed',
      'task-3': 'suspended',
    });
    expect(completedBlock?.taskAssociationLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-2', action: 'disassociated' }),
      expect.objectContaining({ taskId: 'task-3', action: 'associated' }),
    ]));

    await taskTimerService.onBlockEndForTasks(['task-1', 'task-3'], block!.startId);
    await taskService.transitionTask('task-1', 'completed');
    await taskService.transitionTask('task-3', 'suspended');

    expect((await taskService.getTask('task-1'))?.timeBlockIds).toEqual([block!.startId]);
    expect((await taskService.getTask('task-3'))?.timeBlockIds).toEqual([block!.startId]);
    expect((await taskService.getTask('task-2'))?.timeBlockIds ?? []).toEqual([]);
    expect((await taskService.getTask('task-1'))?.status).toBe('completed');
    expect((await taskService.getTask('task-3'))?.status).toBe('suspended');
    expect((await taskService.getTask('task-2'))?.status).toBe('in_progress');
  });
});
