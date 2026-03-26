import { render, screen } from '@testing-library/react';
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
  });
});
