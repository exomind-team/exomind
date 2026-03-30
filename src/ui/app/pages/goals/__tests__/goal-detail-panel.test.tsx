import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

describe('GoalDetailPanel', () => {
  it('does not mark AND or OR as active when the goal has an empty completion rule', async () => {
    const { GoalDetailPanel } = await import('../components/GoalDetailPanel');

    render(
      <GoalDetailPanel
        goal={{
          id: 'goal-empty-rule',
          title: '',
          description: '',
          cancelled: false,
          completionRule: [],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        inEdges={[]}
        outEdges={[]}
        hopDistance={Number.POSITIVE_INFINITY}
        onClose={() => {}}
        onUpdate={() => true}
        onJumpEdge={() => {}}
      />,
    );

    expect(screen.getByText('当前模式：空规则')).toBeInTheDocument();
    expect(screen.getByText('⚠ 无完成条件，请添加任务边')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AND' }).className).not.toContain('bg-[#C75B3A]');
    expect(screen.getByRole('button', { name: 'OR' }).className).not.toContain('bg-[#C75B3A]');
  });

  it('does not mark AND or OR as active when the goal uses a custom mixed completion rule', async () => {
    const { GoalDetailPanel } = await import('../components/GoalDetailPanel');

    render(
      <GoalDetailPanel
        goal={{
          id: 'goal-custom-rule',
          title: '',
          description: '',
          cancelled: false,
          completionRule: [['edge-a', 'edge-b'], ['edge-c']],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        inEdges={[
          {
            id: 'edge-a',
            title: 'A',
            description: '',
            source: 'me',
            target: 'goal-custom-rule',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'edge-b',
            title: 'B',
            description: '',
            source: 'me',
            target: 'goal-custom-rule',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'edge-c',
            title: 'C',
            description: '',
            source: 'me',
            target: 'goal-custom-rule',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        outEdges={[]}
        hopDistance={1}
        onClose={() => {}}
        onUpdate={() => true}
        onJumpEdge={() => {}}
      />,
    );

    expect(screen.getByText('当前模式：自定义')).toBeInTheDocument();
    expect(screen.getByText('(A 且 B) 或 C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AND' }).className).not.toContain('bg-[#C75B3A]');
    expect(screen.getByRole('button', { name: 'OR' }).className).not.toContain('bg-[#C75B3A]');
  });

  it('disables editable goal fields when the goal is completed', async () => {
    const { GoalDetailPanel } = await import('../components/GoalDetailPanel');

    render(
      <GoalDetailPanel
        goal={{
          id: 'goal-completed',
          title: 'Done Goal',
          description: 'Locked',
          cancelled: false,
          completionRule: [['edge-a']],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="completed"
        inEdges={[
          {
            id: 'edge-a',
            title: 'A',
            description: '',
            source: 'me',
            target: 'goal-completed',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        outEdges={[]}
        hopDistance={1}
        onClose={() => {}}
        onUpdate={() => true}
        onJumpEdge={() => {}}
      />,
    );

    expect(screen.getByDisplayValue('Done Goal')).toBeDisabled();
    expect(screen.getByDisplayValue('Locked')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'AND' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'OR' })).toBeDisabled();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('submits the current draft once when an external freeze happens', async () => {
    const { GoalDetailPanel } = await import('../components/GoalDetailPanel');
    const onUpdate = vi.fn(() => true);

    const { rerender } = render(
      <GoalDetailPanel
        goal={{
          id: 'goal-freeze',
          title: 'Old Goal',
          description: 'Old description',
          cancelled: false,
          completionRule: [['edge-a']],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        inEdges={[
          {
            id: 'edge-a',
            title: 'A',
            description: '',
            source: 'me',
            target: 'goal-freeze',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        outEdges={[]}
        hopDistance={1}
        onClose={() => {}}
        onUpdate={onUpdate}
        onJumpEdge={() => {}}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Old Goal'), { target: { value: 'Draft Goal' } });
    fireEvent.change(screen.getByDisplayValue('Old description'), { target: { value: 'Draft description' } });

    rerender(
      <GoalDetailPanel
        goal={{
          id: 'goal-freeze',
          title: 'Old Goal',
          description: 'Old description',
          cancelled: false,
          completionRule: [['edge-a']],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="completed"
        inEdges={[
          {
            id: 'edge-a',
            title: 'A',
            description: '',
            source: 'me',
            target: 'goal-freeze',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        outEdges={[]}
        hopDistance={1}
        onClose={() => {}}
        onUpdate={onUpdate}
        onJumpEdge={() => {}}
      />,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Draft Goal',
      description: 'Draft description',
    });
  });

  it('uses resolved task labels in completion rule and edge lists when edge title is empty', async () => {
    const { GoalDetailPanel } = await import('../components/GoalDetailPanel');

    render(
      <GoalDetailPanel
        goal={{
          id: 'goal-task-labels',
          title: 'Goal',
          description: '',
          cancelled: false,
          completionRule: [['edge-a'], ['edge-b']],
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        inEdges={[
          {
            id: 'edge-a',
            title: '',
            description: '',
            source: 'me',
            target: 'goal-task-labels',
            taskNodeRef: 'task-a',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'edge-b',
            title: '',
            description: '',
            source: 'me',
            target: 'goal-task-labels',
            taskNodeRef: 'task-b',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        outEdges={[
          {
            id: 'edge-out',
            title: '',
            description: '',
            source: 'goal-task-labels',
            target: 'goal-next',
            taskNodeRef: 'task-out',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        hopDistance={1}
        edgeLabelById={{
          'edge-a': '真实任务 A',
          'edge-b': '真实任务 B',
          'edge-out': '真实任务 Out',
        }}
        onClose={() => {}}
        onUpdate={() => true}
        onJumpEdge={() => {}}
      />,
    );

    expect(screen.getByText('真实任务 A 或 真实任务 B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '真实任务 A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '真实任务 B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '真实任务 Out' })).toBeInTheDocument();
  });
});
