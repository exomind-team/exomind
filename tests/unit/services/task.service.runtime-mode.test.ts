import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getInstanceMock } = vi.hoisted(() => ({
  getInstanceMock: vi.fn(),
}));

vi.mock('@/lib/services/task-event-emitter', () => ({
  emitTaskCreated: vi.fn(),
  emitTaskTransition: vi.fn(),
}));

vi.mock('@/lib/environment/environment', () => ({
  ExoMindEnvironment: {
    getInstance: getInstanceMock,
  },
}));

import { TaskServiceImpl } from '@/lib/services/task.service';
import { emitTaskTransition } from '@/lib/services/task-event-emitter';
import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import type { TaskNode, TaskStatus } from '@/lib/types/task';

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  const now = Date.now();
  return {
    id: 'task-1',
    title: '测试任务',
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockPort(task: TaskNode): ITaskPort {
  const current = { ...task };

  return {
    listTasks: vi.fn(async () => [current]),
    getTaskById: vi.fn(async (id: string) => (id === current.id ? current : null)),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(async (id: string) => {
      if (id !== current.id) {
        return null;
      }
      current.status = 'cancelled';
      current.completedAt = Date.now();
      return current;
    }),
    transitionTask: vi.fn(async (id: string, to: TaskStatus) => {
      if (id !== current.id) {
        return null;
      }
      current.status = to;
      current.updatedAt = Date.now();
      return current;
    }),
    getAvailableTransitions: vi.fn(async () => []),
  };
}

describe('TaskService runtime backend mode resolution', () => {
  beforeEach(() => {
    getInstanceMock.mockReset();
    vi.mocked(emitTaskTransition).mockClear();
  });

  it('ignores stored legacy task backend mode on web to avoid duplicate transition events', async () => {
    const port = createMockPort(makeTask());
    getInstanceMock.mockReturnValue({
      runtime: 'web',
      task: port,
    });

    const service = new TaskServiceImpl();
    await service.transitionTask('task-1', 'in_progress');

    expect(emitTaskTransition).not.toHaveBeenCalled();
  });

  it('does not emit legacy transition events on tauri because runtime task flow is RT-only', async () => {
    const port = createMockPort(makeTask({ status: 'in_progress' }));
    getInstanceMock.mockReturnValue({
      runtime: 'tauri',
      task: port,
    });

    const service = new TaskServiceImpl();
    await service.cancelTask('task-1');

    expect(emitTaskTransition).not.toHaveBeenCalled();
  });
});
