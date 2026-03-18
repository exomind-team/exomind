import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import { buildTasksTodayViewModel } from '@/ui/app/pages/tasks-today-view';

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> & { id: string; name: string; startTime: number; endTime: number }): TimeBlock {
  return {
    id: overrides.id,
    name: overrides.name,
    startId: overrides.startId ?? overrides.id,
    endId: overrides.endId ?? `${overrides.id}-end`,
    note: overrides.note,
    tags: overrides.tags ?? new Set(['block_feedback']),
    startTime: overrides.startTime,
    endTime: overrides.endTime,
  };
}

function makeActiveBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  return {
    startId: overrides.startId ?? 'active-block-1',
    name: overrides.name ?? '进行中的时间块',
    mode: overrides.mode ?? 'countup',
    startTime: overrides.startTime ?? Date.now(),
    elapsed: overrides.elapsed ?? 15 * 60 * 1000,
    paused: overrides.paused ?? false,
    phase: overrides.phase ?? 'running',
    version: overrides.version ?? 1,
    taskIds: overrides.taskIds ?? [],
    taskAssociationLog: overrides.taskAssociationLog ?? [],
    taskId: overrides.taskId,
    updatedAt: overrides.updatedAt,
    actorId: overrides.actorId,
    lastTransitionAt: overrides.lastTransitionAt,
    lastResumedAt: overrides.lastResumedAt,
    accumulatedRunMs: overrides.accumulatedRunMs,
    actionEndedAt: overrides.actionEndedAt,
    feedbackStartedAt: overrides.feedbackStartedAt,
    feedbackSubmittedAt: overrides.feedbackSubmittedAt,
    pauseAccumulatedMs: overrides.pauseAccumulatedMs,
    pausedAt: overrides.pausedAt,
    targetMinutes: overrides.targetMinutes,
  };
}

describe('buildTasksTodayViewModel（任务页 today 时间块视图模型）', () => {
  const today = new Date('2026-03-06T10:00:00.000+08:00');
  const morning = new Date('2026-03-06T09:00:00.000+08:00').getTime();
  const noon = new Date('2026-03-06T12:30:00.000+08:00').getTime();
  const afternoon = new Date('2026-03-06T15:30:00.000+08:00').getTime();
  const night = new Date('2026-03-06T20:00:00.000+08:00').getTime();

  it('groups today blocks into 上午/中午/下午/晚上 sections', () => {
    const model = buildTasksTodayViewModel({
      tasks: [],
      blocks: [
        makeBlock({ id: 'b1', name: '晨间例行', startTime: morning, endTime: morning + 30 * 60_000 }),
        makeBlock({ id: 'b2', name: '午休', startTime: noon, endTime: noon + 60 * 60_000 }),
        makeBlock({ id: 'b3', name: '编码', startTime: afternoon, endTime: afternoon + 90 * 60_000 }),
        makeBlock({ id: 'b4', name: '阅读', startTime: night, endTime: night + 60 * 60_000 }),
      ],
      now: today,
      activeBlock: null,
    });

    expect(model.timelineSections.map((section) => section.id)).toEqual(['morning', 'noon', 'afternoon', 'night']);
    expect(model.timelineSections.map((section) => section.label)).toEqual(['上午', '中午', '下午', '晚上']);
  });

  it('collects in-progress tasks into the top summary section', () => {
    const model = buildTasksTodayViewModel({
      tasks: [
        makeTask({ id: 'task-1', title: '完成 Task List 视图设计', status: 'in_progress', updatedAt: morning }),
        makeTask({ id: 'task-2', title: '实现 Today 时间块卡片', status: 'in_progress', updatedAt: afternoon }),
        makeTask({ id: 'task-3', title: '补充回归测试', status: 'pending', dueAt: night, updatedAt: night }),
      ],
      blocks: [],
      now: today,
      activeBlock: null,
    });

    expect(model.inProgressTasks.map((task) => task.id)).toEqual(['task-1', 'task-2']);
    expect(model.inProgressCount).toBe(2);
  });

  it('links completed blocks back to tasks through task.timeBlockIds', () => {
    const model = buildTasksTodayViewModel({
      tasks: [
        makeTask({
          id: 'task-1',
          title: '完成 Task List 视图设计',
          status: 'in_progress',
          timeBlockIds: ['block-1'],
          estimatedMinutes: 120,
          updatedAt: morning,
        }),
      ],
      blocks: [
        makeBlock({
          id: 'block-1',
          name: '深度工作',
          note: '顺利完成，比预期快 30 分钟',
          startTime: morning,
          endTime: morning + 90 * 60_000,
        }),
      ],
      now: today,
      activeBlock: null,
    });

    expect(model.timelineSections).toHaveLength(1);
    expect(model.timelineSections[0].items[0]).toMatchObject({
      title: '完成 Task List 视图设计',
      bucketLabel: '上午',
      timeLabel: '09:00 - 10:30',
      note: '顺利完成，比预期快 30 分钟',
      meta: '预计 2h',
    });
  });

  it('resolves active block task association through taskIds（进行中时间块通过 taskIds 反查任务）', () => {
    const model = buildTasksTodayViewModel({
      tasks: [
        makeTask({
          id: 'task-1',
          title: '联调当下页读路径',
          status: 'in_progress',
          estimatedMinutes: 45,
        }),
      ],
      blocks: [],
      now: today,
      activeBlock: makeActiveBlock({
        startId: 'active-taskids',
        name: '多任务专注块',
        startTime: morning,
        taskIds: ['task-1'],
      }),
    });

    expect(model.timelineSections).toHaveLength(1);
    expect(model.timelineSections[0].items[0]).toMatchObject({
      taskIds: ['task-1'],
      linkedTasks: [{ taskId: 'task-1', title: '联调当下页读路径' }],
      title: '联调当下页读路径',
      tagLabel: '进行中',
      timeLabel: '09:00 - 进行中',
      meta: '预计 45min',
    });
  });

  it('preserves all linked task ids for multi-task active block（多任务活跃时间块不应压扁为单个 taskId）', () => {
    const model = buildTasksTodayViewModel({
      tasks: [
        makeTask({
          id: 'task-1',
          title: '联调专注页',
          status: 'in_progress',
          estimatedMinutes: 45,
        }),
        makeTask({
          id: 'task-2',
          title: '补充时间块回归',
          status: 'pending',
          estimatedMinutes: 30,
        }),
      ],
      blocks: [],
      now: today,
      activeBlock: makeActiveBlock({
        startId: 'active-multi',
        name: '多任务专注块',
        startTime: morning,
        taskIds: ['task-1', 'task-2'],
      }),
    });

    expect(model.timelineSections).toHaveLength(1);
    expect(model.timelineSections[0].items[0]).toMatchObject({
      taskIds: ['task-1', 'task-2'],
      linkedTasks: [
        { taskId: 'task-1', title: '联调专注页' },
        { taskId: 'task-2', title: '补充时间块回归' },
      ],
      title: '联调专注页 / 补充时间块回归',
      tagLabel: '多任务',
      meta: '2 个关联任务',
    });
  });
});
