import { describe, expect, it } from 'vitest';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import {
  EMPTY_TASK_DAG_VISIBILITY_STATE,
  findVisibleTaskGraphConnectedComponentNodeIds,
  projectVisibleTaskGraph,
} from '@/lib/task/task-dag-visibility';
import type { TaskNode } from '@/lib/types/task';

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('task-dag-visibility issue #395（聚焦系列）', () => {
  it('finds the undirected connected component from the current visible graph（基于当前可见图计算无向连通分量）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({
        id: 'task-c',
        title: 'C',
        dependsOn: [{ taskId: 'task-b', type: 'soft' }],
      }),
      makeTask({ id: 'task-x', title: 'X' }),
      makeTask({
        id: 'task-y',
        title: 'Y',
        dependsOn: [{ taskId: 'task-x', type: 'hard' }],
      }),
    ]);

    const visibleGraph = projectVisibleTaskGraph(graph, EMPTY_TASK_DAG_VISIBILITY_STATE);

    expect(findVisibleTaskGraphConnectedComponentNodeIds(visibleGraph, 'task-b')).toEqual(
      new Set(['task-a', 'task-b', 'task-c']),
    );
    expect(findVisibleTaskGraphConnectedComponentNodeIds(visibleGraph, 'task-y')).toEqual(
      new Set(['task-x', 'task-y']),
    );
  });

  it('does not resurrect collapsed nodes into the focused component（折叠隐藏节点不会被聚焦重新带回）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({
        id: 'task-c',
        title: 'C',
        dependsOn: [{ taskId: 'task-b', type: 'hard' }],
      }),
      makeTask({ id: 'task-z', title: 'Z' }),
    ]);

    const visibleGraph = projectVisibleTaskGraph(graph, {
      collapsedUpstreamOf: ['task-b'],
      collapsedDownstreamOf: [],
    });

    expect(visibleGraph.nodes.map((node) => node.id)).toEqual(['task-b', 'task-c', 'task-z']);
    expect(findVisibleTaskGraphConnectedComponentNodeIds(visibleGraph, 'task-c')).toEqual(
      new Set(['task-b', 'task-c']),
    );
  });

  it('returns an empty set when the focus anchor is not currently visible（锚点当前不可见时返回空集合）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    const visibleGraph = projectVisibleTaskGraph(graph, {
      collapsedUpstreamOf: ['task-b'],
      collapsedDownstreamOf: [],
    });

    expect(findVisibleTaskGraphConnectedComponentNodeIds(visibleGraph, 'task-a')).toEqual(new Set());
  });
});
