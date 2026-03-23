import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import { buildTaskDagDetailView } from '@/ui/app/pages/task-dag-detail-view';

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

describe('buildTaskDagDetailView issue #395', () => {
  it('keeps current-root guidance disabled for cyclic source graphs', () => {
    const taskA = makeTask({
      id: 'a',
      title: 'A',
      createdAt: 10,
      updatedAt: 10,
      dependsOn: [{ taskId: 'b', type: 'hard' }],
    });
    const taskB = makeTask({
      id: 'b',
      title: 'B',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    });

    const view = buildTaskDagDetailView(taskA, [taskA, taskB], { collapsedUpstreamOf: ['a'], collapsedDownstreamOf: [] });

    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      hasCycle: true,
      visibleRootNodeIds: ['a'],
      visibleCurrentRootNodeId: null,
      visibleCurrentRootTitle: null,
      sourceCurrentRootNodeId: null,
      sourceCurrentRootTitle: null,
      isSourceCurrentRootVisible: false,
    });
    expect(view?.nodes.every((node) => node.isVisibleCurrentRoot === false)).toBe(true);
  });

  it('disables upstream collapse when external descendants would leak semantics', () => {
    const taskRoot = makeTask({ id: 'root', title: 'Root', createdAt: 10, updatedAt: 10 });
    const taskCurrent = makeTask({
      id: 'current',
      title: 'Current',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'root', type: 'hard' }],
    });
    const externalParent = makeTask({ id: 'external', title: 'External', createdAt: 15, updatedAt: 15 });
    const externalChild = makeTask({
      id: 'external-child',
      title: 'External Child',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [
        { taskId: 'root', type: 'hard' },
        { taskId: 'external', type: 'hard' },
      ],
    });

    const view = buildTaskDagDetailView(taskCurrent, [taskRoot, taskCurrent, externalParent, externalChild], {
      collapsedUpstreamOf: [],
      collapsedDownstreamOf: [],
    });

    expect(view).not.toBeNull();
    expect(view?.nodes.find((node) => node.id === 'current')).toMatchObject({
      upstreamNodeCount: 1,
      canCollapseUpstream: false,
    });
  });
});
