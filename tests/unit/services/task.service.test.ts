import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskServiceImpl } from '@/lib/services/task.service';
import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import type { TaskItem } from '@/lib/types/task';

function createTask(id: string): TaskItem {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    progress: 0,
    createdAt: '2026-02-23T00:00:00.000Z',
    updatedAt: '2026-02-23T00:00:00.000Z',
    timer: {
      mode: 'countdown',
      paused: false,
      elapsedMs: 25 * 60 * 1000,
      remainingMs: 25 * 60 * 1000,
      targetMinutes: 25,
    },
  };
}

describe('task service（任务服务）', () => {
  let taskPort: ITaskPort;
  let service: TaskServiceImpl;

  beforeEach(() => {
    taskPort = {
      listTasks: vi.fn(async () => [createTask('1'), createTask('2')]),
      getTaskById: vi.fn(async (taskId: string) => createTask(taskId)),
      createTask: vi.fn(async (input) => createTask(input.title)),
      setTaskTimerMode: vi.fn(async (taskId: string) => ({
        ...createTask(taskId),
        timer: {
          ...createTask(taskId).timer,
          mode: 'countup',
        },
      })),
      pauseTask: vi.fn(async (taskId: string) => ({
        ...createTask(taskId),
        timer: {
          ...createTask(taskId).timer,
          paused: true,
        },
      })),
      resumeTask: vi.fn(async (taskId: string) => ({
        ...createTask(taskId),
        timer: {
          ...createTask(taskId).timer,
          paused: false,
        },
      })),
      upsertTask: vi.fn(async () => undefined),
    };

    service = new TaskServiceImpl({ task: taskPort });
  });

  it('loads task list（加载任务列表）', async () => {
    const tasks = await service.listTasks();
    expect(tasks).toHaveLength(2);
    expect(taskPort.listTasks).toHaveBeenCalledTimes(1);
  });

  it('switches timer mode（切换计时模式）', async () => {
    const updated = await service.setTimerMode('1', 'countup');
    expect(updated?.timer.mode).toBe('countup');
    expect(taskPort.setTaskTimerMode).toHaveBeenCalledWith('1', 'countup');
  });

  it('pauses and resumes task（暂停与恢复任务）', async () => {
    const paused = await service.pauseTask('1');
    expect(paused?.timer.paused).toBe(true);

    const resumed = await service.resumeTask('1');
    expect(resumed?.timer.paused).toBe(false);

    expect(taskPort.pauseTask).toHaveBeenCalledWith('1');
    expect(taskPort.resumeTask).toHaveBeenCalledWith('1');
  });

  it('creates task（创建任务）', async () => {
    const created = await service.createTask({
      title: 'new-task',
      mode: 'countdown',
      targetMinutes: 25,
    });
    expect(created.title).toBe('Task new-task');
    expect(taskPort.createTask).toHaveBeenCalledWith({
      title: 'new-task',
      mode: 'countdown',
      targetMinutes: 25,
    });
  });
});

