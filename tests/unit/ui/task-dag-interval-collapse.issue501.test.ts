import { describe, expect, it } from 'vitest';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { EMPTY_TASK_DAG_VISIBILITY_STATE, projectVisibleTaskGraph } from '@/lib/task/task-dag-visibility';
import {
  EMPTY_TASK_DAG_INTERVAL_COLLAPSE_STATE,
  projectVisibleTaskGraphWithIntervalCollapses,
  resolveTaskDagIntervalDefinition,
  validateTaskDagIntervalAgainstExisting,
  type TaskDagIntervalCollapseState,
} from '@/lib/task/task-dag-interval-collapse';
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

function buildProjectedGraph(tasks: TaskNode[], state: TaskDagIntervalCollapseState) {
  const graph = buildTaskGraph(tasks);
  const visibleGraph = projectVisibleTaskGraph(graph, EMPTY_TASK_DAG_VISIBILITY_STATE);
  return projectVisibleTaskGraphWithIntervalCollapses(graph, visibleGraph, state);
}

describe('task-dag-interval-collapse issue #501（区间收缩）', () => {
  it('auto-determines start and terminal direction from any endpoint order（自动判定起点与终点方向）', () => {
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
    ]);

    const result = resolveTaskDagIntervalDefinition(graph, 'task-c', 'task-a');

    expect(result).toMatchObject({
      ok: true,
      startId: 'task-a',
      endId: 'task-c',
      nodeIds: ['task-a', 'task-b', 'task-c'],
    });
  });

  it('rejects intervals whose internal nodes have external incoming dependencies（内部节点存在边界外上游依赖时禁止收缩）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({ id: 'task-x', title: 'X' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [
          { taskId: 'task-a', type: 'hard' },
          { taskId: 'task-x', type: 'hard' },
        ],
      }),
      makeTask({
        id: 'task-c',
        title: 'C',
        dependsOn: [{ taskId: 'task-b', type: 'hard' }],
      }),
    ]);

    const result = resolveTaskDagIntervalDefinition(graph, 'task-a', 'task-c');

    expect(result).toMatchObject({
      ok: false,
      reason: 'external-incoming',
    });
  });

  it('rejects partial overlap while still allowing nested ranges（禁止部分重叠，但允许嵌套）', () => {
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
      makeTask({
        id: 'task-d',
        title: 'D',
        dependsOn: [{ taskId: 'task-c', type: 'hard' }],
      }),
      makeTask({
        id: 'task-e',
        title: 'E',
        dependsOn: [{ taskId: 'task-d', type: 'hard' }],
      }),
    ]);

    const existing = resolveTaskDagIntervalDefinition(graph, 'task-b', 'task-d');
    const nested = resolveTaskDagIntervalDefinition(graph, 'task-c', 'task-d');
    const partial = resolveTaskDagIntervalDefinition(graph, 'task-c', 'task-e');

    expect(existing.ok).toBe(true);
    expect(nested.ok).toBe(true);
    expect(partial.ok).toBe(true);

    expect(validateTaskDagIntervalAgainstExisting(
      nested.ok ? nested : null,
      existing.ok ? [existing] : [],
    )).toMatchObject({ ok: true });

    expect(validateTaskDagIntervalAgainstExisting(
      partial.ok ? partial : null,
      existing.ok ? [existing] : [],
    )).toMatchObject({
      ok: false,
      reason: 'partial-overlap',
    });
  });

  it('projects a collapsed interval onto the terminal node instead of creating a new truth node（收缩后复用终点节点）', () => {
    const projection = buildProjectedGraph([
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
      makeTask({
        id: 'task-d',
        title: 'D',
        dependsOn: [{ taskId: 'task-c', type: 'hard' }],
      }),
      makeTask({
        id: 'task-e',
        title: 'E',
        dependsOn: [{ taskId: 'task-d', type: 'hard' }],
      }),
    ], {
      intervals: [{ startId: 'task-b', endId: 'task-d', collapsed: true }],
    });

    expect(projection.visibleGraph.nodes.map((node) => node.id)).toEqual(['task-a', 'task-d', 'task-e']);
    expect(projection.visibleGraph.edges.map((edge) => [edge.source, edge.target, edge.type])).toEqual([
      ['task-a', 'task-d', 'hard'],
      ['task-d', 'task-e', 'hard'],
    ]);
    expect(projection.collapsedIntervalsByTerminalId.get('task-d')).toMatchObject([
      {
        startId: 'task-b',
        endId: 'task-d',
        memberCount: 3,
        hiddenNodeIds: ['task-b', 'task-c'],
      },
    ]);
  });

  it('keeps expanded outer intervals while preserving inner collapsed intervals（展开外层时保留内层收缩关系）', () => {
    const projection = buildProjectedGraph([
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
      makeTask({
        id: 'task-d',
        title: 'D',
        dependsOn: [{ taskId: 'task-c', type: 'hard' }],
      }),
      makeTask({
        id: 'task-e',
        title: 'E',
        dependsOn: [{ taskId: 'task-d', type: 'hard' }],
      }),
    ], {
      intervals: [
        { startId: 'task-b', endId: 'task-e', collapsed: false },
        { startId: 'task-c', endId: 'task-d', collapsed: true },
      ],
    });

    expect(projection.visibleGraph.nodes.map((node) => node.id)).toEqual(['task-a', 'task-b', 'task-d', 'task-e']);
    expect(projection.collapsedIntervalsByTerminalId.get('task-d')).toMatchObject([
      {
        startId: 'task-c',
        endId: 'task-d',
        memberCount: 2,
      },
    ]);
    expect(projection.normalizedState).toEqual({
      intervals: [
        { startId: 'task-b', endId: 'task-e', collapsed: false },
        { startId: 'task-c', endId: 'task-d', collapsed: true },
      ],
    });
  });

  it('defaults interval collapse state to empty（默认区间收缩状态为空）', () => {
    expect(EMPTY_TASK_DAG_INTERVAL_COLLAPSE_STATE).toEqual({ intervals: [] });
  });
});
