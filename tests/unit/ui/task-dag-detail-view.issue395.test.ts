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

    const view = buildTaskDagDetailView(taskA, [taskA, taskB], { collapsedUpstreamOf: ['a'] });

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
});
