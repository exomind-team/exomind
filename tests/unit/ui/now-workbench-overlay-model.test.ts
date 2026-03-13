import { describe, expect, it } from 'vitest';
import type { Event, ActiveBlockData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

function createTask(input: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title' | 'status'>): TaskNode {
  const now = Date.UTC(2026, 2, 11, 9, 0, 0);
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    priority: input.priority ?? 'medium',
    dependsOn: input.dependsOn ?? [],
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    dueAt: input.dueAt,
    timeBlockIds: input.timeBlockIds,
    description: input.description,
    estimatedMinutes: input.estimatedMinutes,
    source: input.source,
    parentId: input.parentId,
    doneCondition: input.doneCondition,
    completedAt: input.completedAt,
  };
}

function createEvent(id: string, content: string, timestamp: number): Event {
  return {
    id,
    content,
    timestamp,
    tags: new Set(),
    metadata: undefined,
  };
}

function createActiveBlock(partial: Partial<ActiveBlockData> = {}): ActiveBlockData {
  return {
    startId: partial.startId ?? 'block-start-1',
    name: partial.name ?? '写实现计划',
    mode: partial.mode ?? 'countdown',
    startTime: partial.startTime ?? Date.UTC(2026, 2, 11, 9, 0, 0),
    elapsed: partial.elapsed ?? 10 * 60 * 1000,
    paused: partial.paused ?? false,
    phase: partial.phase,
    taskId: partial.taskId,
    targetMinutes: partial.targetMinutes,
    updatedAt: partial.updatedAt,
    version: partial.version,
    actorId: partial.actorId,
    lastTransitionAt: partial.lastTransitionAt,
    lastResumedAt: partial.lastResumedAt,
    accumulatedRunMs: partial.accumulatedRunMs,
    actionEndedAt: partial.actionEndedAt,
    feedbackStartedAt: partial.feedbackStartedAt,
    feedbackSubmittedAt: partial.feedbackSubmittedAt,
    pauseAccumulatedMs: partial.pauseAccumulatedMs,
    pausedAt: partial.pausedAt,
  };
}

describe('now workbench overlay model（当下工作台悬浮窗视图模型）', () => {
  it('returns running mode when an active block exists（有活跃时间块时返回运行态）', async () => {
    const module = await import('@/ui/app/overlay/now-workbench-overlay-model');
    const model = module.buildNowWorkbenchOverlayModel({
      activeBlock: createActiveBlock({ name: '推进悬浮工作台' }),
      tasks: [],
      events: [],
      now: Date.UTC(2026, 2, 11, 9, 30, 0),
    });

    expect(model.mode).toBe('running');
    expect(model.statusLabel).toBe('进行中');
    expect(model.title).toBe('推进悬浮工作台');
  });

  it('returns idle_with_tasks when there is no active block but visible tasks exist（无活跃时间块但有任务时返回任务态）', async () => {
    const module = await import('@/ui/app/overlay/now-workbench-overlay-model');
    const model = module.buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [
        createTask({
          id: 'task-in-progress',
          title: '先补测试',
          status: 'in_progress',
          updatedAt: Date.UTC(2026, 2, 11, 9, 20, 0),
        }),
        createTask({
          id: 'task-due-first',
          title: '补模型',
          status: 'not_started',
          dueAt: Date.UTC(2026, 2, 11, 10, 0, 0),
        }),
        createTask({
          id: 'task-no-due',
          title: '整理文档',
          status: 'not_started',
          updatedAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        }),
      ],
      events: [],
      now: Date.UTC(2026, 2, 11, 9, 30, 0),
    });

    expect(model.mode).toBe('idle_with_tasks');
    expect(model.statusLabel).toBe('未开始');
    expect(model.visibleTasks.map((task) => task.id)).toEqual([
      'task-in-progress',
      'task-due-first',
      'task-no-due',
    ]);
  });

  it('returns idle_input_only when neither active block nor visible tasks exist（无时间块且无任务时返回纯输入态）', async () => {
    const module = await import('@/ui/app/overlay/now-workbench-overlay-model');
    const model = module.buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [
        createTask({
          id: 'task-abandoned',
          title: '放弃的任务',
          status: 'abandoned',
        }),
      ],
      events: [],
      now: Date.UTC(2026, 2, 11, 9, 30, 0),
    });

    expect(model.mode).toBe('idle_input_only');
    expect(model.visibleTasks).toEqual([]);
    expect(model.statusLabel).toBe('随时记录');
  });

  it('keeps only the latest two event summaries（仅保留最新两条事件摘要）', async () => {
    const module = await import('@/ui/app/overlay/now-workbench-overlay-model');
    const model = module.buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [],
      events: [
        createEvent('event-1', '最早的记录', Date.UTC(2026, 2, 11, 8, 0, 0)),
        createEvent('event-2', '中间的记录', Date.UTC(2026, 2, 11, 8, 30, 0)),
        createEvent('event-3', '最新的记录', Date.UTC(2026, 2, 11, 9, 0, 0)),
      ],
      now: Date.UTC(2026, 2, 11, 9, 30, 0),
    });

    expect(model.recentEvents.map((event) => event.id)).toEqual(['event-3', 'event-2']);
  });
});
