import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskServiceImpl } from '@/lib/services/task.service';
import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import type { TaskGoalGroup, TaskItem } from '@/lib/types/task';

function createTask(id: string, overrides?: Partial<TaskItem>): TaskItem {
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
    ...overrides,
  };
}

function createGoalGroup(id: string): TaskGoalGroup {
  return {
    id,
    icon: '📚',
    title: `Group ${id}`,
    badgeText: '1',
    badgeTone: 'indigo',
    goals: [
      {
        id: `${id}-goal`,
        title: `Goal ${id}`,
        focus: 'focus',
        acceptance: 'acceptance',
        stage: '阶段: mock',
        stageTone: 'indigo',
        status: {
          icon: '🔥',
          text: '进行中',
          tone: 'success',
        },
        accentTone: 'indigo',
      },
    ],
  };
}

describe('task service（任务服务）', () => {
  let taskPort: ITaskPort;
  let service: TaskServiceImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T10:00:00.000Z'));

    taskPort = {
      listTasks: vi.fn(async () => [
        createTask('in-progress', {
          status: 'in_progress',
          dueAt: '2026-02-25T15:00:00.000Z',
          updatedAt: '2026-02-25T08:00:00.000Z',
        }),
        createTask('today-active', {
          status: 'todo',
          dueAt: '2026-02-25T20:00:00.000Z',
          updatedAt: '2026-02-25T09:00:00.000Z',
        }),
        createTask('week-with-due', {
          status: 'todo',
          dueAt: '2026-02-27T12:00:00.000Z',
          updatedAt: '2026-02-24T09:00:00.000Z',
        }),
        createTask('no-due', {
          status: 'todo',
          updatedAt: '2026-02-24T10:00:00.000Z',
        }),
        createTask('done-task', {
          status: 'done',
          dueAt: '2026-02-25T11:00:00.000Z',
        }),
      ]),
      getLongTermGoals: vi.fn(async () => [createGoalGroup('g1')]),
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads task list（加载任务列表）', async () => {
    const tasks = await service.listTasks();
    expect(tasks).toHaveLength(5);
    expect(taskPort.listTasks).toHaveBeenCalledTimes(1);
  });

  it('applies now tab rule（当下仅进行中）', async () => {
    const tasks = await service.listTasksByTab('now');
    expect(tasks.map((task) => task.id)).toEqual(['in-progress']);
  });

  it('applies today tab rule（今日按截止和活跃筛选）', async () => {
    const tasks = await service.listTasksByTab('today');
    expect(tasks.map((task) => task.id)).toEqual(['in-progress', 'today-active']);
  });

  it('places no-due tasks at bottom for week/month（周月视图无截止置底）', async () => {
    const weekTasks = await service.listTasksByTab('week');
    expect(weekTasks.map((task) => task.id)).toEqual(['in-progress', 'today-active', 'week-with-due', 'no-due']);

    const monthTasks = await service.listTasksByTab('month');
    expect(monthTasks.at(-1)?.id).toBe('no-due');
  });

  it('loads long-term goals（加载长期目标）', async () => {
    const groups = await service.getLongTermGoals();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Group g1');
    expect(taskPort.getLongTermGoals).toHaveBeenCalledTimes(1);
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
