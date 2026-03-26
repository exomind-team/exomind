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
});
