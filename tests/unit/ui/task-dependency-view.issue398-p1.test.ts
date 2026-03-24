import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import { buildTaskDependencyView } from '@/ui/app/pages/task-dependency-view';

function makeTask(overrides: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title'>): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: '',
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    timeBlockIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('buildTaskDependencyView issue #398 P1', () => {
  it('excludes current task from candidates（排除当前任务自身）', () => {
    const currentTask = makeTask({ id: 'task-1', title: '当前任务' });
    const otherTask = makeTask({ id: 'task-2', title: '其他任务' });

    const view = buildTaskDependencyView(currentTask, [currentTask, otherTask]);

    expect(view.candidates.map((candidate) => candidate.id)).toEqual(['task-2']);
  });

  it('excludes existing dependencies from candidates（排除已存在依赖）', () => {
    const dependencyTask = makeTask({ id: 'task-2', title: '已有依赖' });
    const currentTask = makeTask({
      id: 'task-1',
      title: '当前任务',
      dependsOn: [{ taskId: 'task-2', type: 'soft' }],
    });
    const otherTask = makeTask({ id: 'task-3', title: '新候选' });

    const view = buildTaskDependencyView(currentTask, [currentTask, dependencyTask, otherTask]);

    expect(view.candidates.map((candidate) => candidate.id)).toEqual(['task-3']);
  });

  it('marks cancelled tasks as disabled（已取消任务标记禁用）', () => {
    const currentTask = makeTask({ id: 'task-1', title: '当前任务' });
    const cancelledTask = makeTask({
      id: 'task-2',
      title: '已取消任务',
      status: 'cancelled',
    });

    const view = buildTaskDependencyView(currentTask, [currentTask, cancelledTask]);
    const candidate = view.candidates.find((item) => item.id === 'task-2');

    expect(candidate).toMatchObject({
      id: 'task-2',
      disabled: true,
      disabledReason: '任务已取消',
    });
  });

  it('marks cycle-producing candidates as disabled（会成环的候选标记禁用）', () => {
    const taskA = makeTask({
      id: 'task-a',
      title: '任务 A',
      dependsOn: [{ taskId: 'task-b', type: 'hard' }],
    });
    const taskB = makeTask({
      id: 'task-b',
      title: '任务 B',
      dependsOn: [{ taskId: 'task-c', type: 'hard' }],
    });
    const taskC = makeTask({ id: 'task-c', title: '任务 C' });
    const taskD = makeTask({ id: 'task-d', title: '任务 D' });

    const view = buildTaskDependencyView(taskC, [taskA, taskB, taskC, taskD]);
    const cycleCandidate = view.candidates.find((item) => item.id === 'task-a');

    expect(cycleCandidate).toMatchObject({
      id: 'task-a',
      disabled: true,
      disabledReason: '会形成循环依赖',
    });
  });

  it('keeps valid candidates selectable（正常候选保持可选）', () => {
    const taskA = makeTask({ id: 'task-a', title: '任务 A' });
    const taskB = makeTask({ id: 'task-b', title: '任务 B' });

    const view = buildTaskDependencyView(taskA, [taskA, taskB]);
    const candidate = view.candidates.find((item) => item.id === 'task-b');

    expect(candidate).toMatchObject({
      id: 'task-b',
      disabled: false,
    });
    expect(candidate?.disabledReason).toBeUndefined();
  });
});
