import { describe, expect, it } from 'vitest';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { EMPTY_TASK_DAG_VISIBILITY_STATE, projectVisibleTaskGraph } from '@/lib/task/task-dag-visibility';
import type { TaskNode } from '@/lib/types/task';
import {
  TASK_DAG_NODE_HEIGHT,
  TASK_DAG_NODE_WIDTH,
  buildTaskDagFlow,
  buildVisibleTaskDagFlow,
} from '@/ui/app/pages/task-dag-flow';

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

describe('task-dag-flow issue #564（Sugiyama 布局）', () => {
  it('uses the 160x160 slot box as the shared DAG layout baseline（使用统一 160×160 占位盒）', () => {
    expect(TASK_DAG_NODE_WIDTH).toBe(160);
    expect(TASK_DAG_NODE_HEIGHT).toBe(160);
  });

  it('uses left-right layout handles and dagre-routed edges in LR mode', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    const flow = buildTaskDagFlow(graph, { direction: 'LR' });
    const nodeA = flow.nodes.find((node) => node.id === 'task-a');
    const nodeB = flow.nodes.find((node) => node.id === 'task-b');

    expect(nodeA).toMatchObject({
      sourcePosition: 'right',
      targetPosition: 'left',
    });
    expect(nodeB).toMatchObject({
      sourcePosition: 'right',
      targetPosition: 'left',
    });
    expect(nodeB?.position.x).toBeGreaterThan(nodeA?.position.x ?? 0);
    expect(flow.edges[0]).toMatchObject({ type: 'dagreRouted' });
  });

  it('uses top-bottom layout handles in TB mode', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    const flow = buildTaskDagFlow(graph, { direction: 'TB' });
    const nodeA = flow.nodes.find((node) => node.id === 'task-a');
    const nodeB = flow.nodes.find((node) => node.id === 'task-b');

    expect(nodeA).toMatchObject({
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
    expect(nodeB).toMatchObject({
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
    expect(nodeB?.position.y).toBeGreaterThan(nodeA?.position.y ?? 0);
    expect(flow.edges[0]).toMatchObject({ type: 'dagreRouted' });
  });

  it('overlays manual positions node-by-node while new ids keep auto layout（手动坐标逐节点覆盖且新节点保留自动布局）', () => {
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

    const autoFlow = buildTaskDagFlow(graph, { direction: 'LR' });
    const manualFlow = buildTaskDagFlow(graph, {
      direction: 'LR',
      manualPositions: {
        'task-a': { x: 910, y: 420 },
        'task-stale': { x: 1, y: 2 },
      },
    });

    expect(manualFlow.nodes.find((node) => node.id === 'task-a')?.position).toEqual({ x: 910, y: 420 });
    expect(manualFlow.nodes.find((node) => node.id === 'task-b')?.position).toEqual(
      autoFlow.nodes.find((node) => node.id === 'task-b')?.position,
    );
    expect(manualFlow.nodes.find((node) => node.id === 'task-c')?.position).toEqual(
      autoFlow.nodes.find((node) => node.id === 'task-c')?.position,
    );
  });

  it('reuses the same manual positions across direction changes（方向切换复用同一份手动坐标）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);
    const manualPositions = {
      'task-a': { x: 300, y: 140 },
      'task-b': { x: 620, y: 180 },
    };

    const leftRightFlow = buildTaskDagFlow(graph, { direction: 'LR', manualPositions });
    const topBottomFlow = buildTaskDagFlow(graph, { direction: 'TB', manualPositions });

    expect(leftRightFlow.nodes.map((node) => ({ id: node.id, position: node.position }))).toEqual([
      { id: 'task-a', position: { x: 300, y: 140 } },
      { id: 'task-b', position: { x: 620, y: 180 } },
    ]);
    expect(topBottomFlow.nodes.map((node) => ({ id: node.id, position: node.position }))).toEqual([
      { id: 'task-a', position: { x: 300, y: 140 } },
      { id: 'task-b', position: { x: 620, y: 180 } },
    ]);
    expect(leftRightFlow.nodes[0]).toMatchObject({
      sourcePosition: 'right',
      targetPosition: 'left',
    });
    expect(topBottomFlow.nodes[0]).toMatchObject({
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
  });

  it('marks non-focused nodes and edges as dimmed without removing them（聚焦系列仅弱化非本系列元素）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({ id: 'task-x', title: 'X' }),
    ]);
    const visibleGraph = projectVisibleTaskGraph(graph, EMPTY_TASK_DAG_VISIBILITY_STATE);

    const flow = buildVisibleTaskDagFlow(visibleGraph, {
      direction: 'LR',
      focusedSeriesNodeIds: new Set(['task-a', 'task-b']),
    });

    expect(flow.nodes.find((node) => node.id === 'task-a')?.data.isFocusDimmed).toBe(false);
    expect(flow.nodes.find((node) => node.id === 'task-b')?.data.isFocusDimmed).toBe(false);
    expect(flow.nodes.find((node) => node.id === 'task-x')?.data.isFocusDimmed).toBe(true);
    expect(flow.edges.every((edge) => edge.data?.isFocusDimmed === false)).toBe(true);
  });

  it('stacks search dimming and focus dimming independently on the same visible graph', () => {
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
      makeTask({ id: 'task-x', title: 'X' }),
    ]);
    const visibleGraph = projectVisibleTaskGraph(graph, EMPTY_TASK_DAG_VISIBILITY_STATE);

    const flow = buildVisibleTaskDagFlow(visibleGraph, {
      direction: 'LR',
      hasActiveSearch: true,
      searchMatchedTaskIds: new Set(['task-c', 'task-x']),
      focusedSeriesNodeIds: new Set(['task-a', 'task-b', 'task-c']),
    });

    expect(flow.nodes.find((node) => node.id === 'task-a')?.data).toMatchObject({
      isSearchMatch: false,
      isSearchDimmed: true,
      isFocusDimmed: false,
    });
    expect(flow.nodes.find((node) => node.id === 'task-b')?.data).toMatchObject({
      isSearchMatch: false,
      isSearchDimmed: true,
      isFocusDimmed: false,
    });
    expect(flow.nodes.find((node) => node.id === 'task-c')?.data).toMatchObject({
      isSearchMatch: true,
      isSearchDimmed: false,
      isFocusDimmed: false,
    });
    expect(flow.nodes.find((node) => node.id === 'task-x')?.data).toMatchObject({
      isSearchMatch: true,
      isSearchDimmed: false,
      isFocusDimmed: true,
    });
  });

  it('marks smart-terminal survivors as secondary nodes without removing them（智能隐藏保留的终态节点会标记为次要节点）', () => {
    const graph = buildTaskGraph([
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({
        id: 'task-b',
        title: 'B',
        status: 'completed',
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);
    const visibleGraph = projectVisibleTaskGraph(graph, EMPTY_TASK_DAG_VISIBILITY_STATE);

    const flow = buildVisibleTaskDagFlow(visibleGraph, {
      direction: 'LR',
      secondaryNodeIds: new Set(['task-b']),
    } as never);

    expect(flow.nodes.find((node) => node.id === 'task-b')?.data).toMatchObject({
      isSecondaryNode: true,
    });
  });
});
