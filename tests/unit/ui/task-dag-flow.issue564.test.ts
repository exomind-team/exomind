import { describe, expect, it } from 'vitest';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { buildTaskDagFlow } from '@/ui/app/pages/task-dag-flow';

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
});
