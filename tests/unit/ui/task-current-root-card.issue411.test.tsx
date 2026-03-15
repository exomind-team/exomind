import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

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

function renderCurrentRootCard(tasks: TaskNode[]) {
  const graph = buildTaskGraph(tasks);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  render(<TaskCurrentRootCard graph={graph} taskById={taskById} />);
  return { graph };
}

describe('TaskCurrentRootCard issue-411（当前根节点按未阻塞判定）', () => {
  it('shows downstream unblocked node instead of empty state when structural roots are terminal', () => {
    const completedRoot = makeTask({
      id: 'done-root',
      title: '已完成根节点',
      status: 'completed',
      createdAt: 10,
      updatedAt: 10,
    });
    const downstream = makeTask({
      id: 'downstream-open',
      title: '下游可执行节点',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'done-root', type: 'hard' }],
    });

    const { graph } = renderCurrentRootCard([downstream, completedRoot]);

    expect(graph.rootNodeIds).toEqual(['done-root']);
    expect(graph.currentRootCandidateNodeIds).toEqual(['downstream-open']);
    expect(graph.currentRootNodeId).toBe('downstream-open');
    expect(screen.getByTestId('task-current-root-card')).toHaveTextContent('下游可执行节点');
    expect(screen.queryByText('暂无未阻塞节点')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card')).toHaveTextContent(
      '共 1 个未阻塞节点 · 当前按稳定顺序排第 1 个',
    );
  });

  it('does not pick a node whose hard dependency is unfinished', () => {
    const hardSource = makeTask({
      id: 'hard-source',
      title: '硬依赖前置',
      status: 'in_progress',
      createdAt: 10,
      updatedAt: 10,
    });
    const hardTarget = makeTask({
      id: 'hard-target',
      title: '硬依赖目标',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'hard-source', type: 'hard' }],
    });

    const { graph } = renderCurrentRootCard([hardTarget, hardSource]);

    expect(graph.currentRootNodeId).toBe('hard-source');
    expect(graph.currentRootCandidateNodeIds).toEqual(['hard-source']);
    expect(screen.getByTestId('task-current-root-card')).toHaveTextContent('硬依赖前置');
    expect(screen.getByTestId('task-current-root-card')).not.toHaveTextContent('硬依赖目标');
  });

  it('does not pick a node whose soft dependency is not started', () => {
    const softSource = makeTask({
      id: 'soft-source',
      title: '软依赖前置',
      status: 'pending',
      createdAt: 10,
      updatedAt: 10,
    });
    const softTarget = makeTask({
      id: 'soft-target',
      title: '软依赖目标',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'soft-source', type: 'soft' }],
    });

    const { graph } = renderCurrentRootCard([softTarget, softSource]);

    expect(graph.currentRootNodeId).toBe('soft-source');
    expect(graph.currentRootCandidateNodeIds).toEqual(['soft-source']);
    expect(screen.getByTestId('task-current-root-card')).toHaveTextContent('软依赖前置');
    expect(screen.getByTestId('task-current-root-card')).not.toHaveTextContent('软依赖目标');
  });
});
