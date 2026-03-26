import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

describe('GoalFlowNode', () => {
  it('renders pending goals with the default cool gradient and in-progress goals with amber emphasis', async () => {
    const { GoalFlowNode } = await import('../components/GoalFlowNode');
    const buildProps = (overrides: Partial<ComponentProps<typeof GoalFlowNode>>): ComponentProps<typeof GoalFlowNode> => ({
      id: 'goal-node',
      type: 'goal',
      data: {
        title: 'Goal',
        status: 'pending',
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      selectable: true,
      deletable: true,
      draggable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      ...overrides,
    });

    const { rerender } = render(
      <GoalFlowNode
        {...buildProps({
          id: 'goal-pending',
          data: {
            title: 'Pending Goal',
            status: 'pending',
          },
        })}
      />,
    );

    expect(screen.getByTestId('goal-flow-node-goal-pending').className).toContain('from-sky-400');
    expect(screen.getByTestId('goal-flow-node-goal-pending').className).toContain('to-indigo-500');

    rerender(
      <GoalFlowNode
        {...buildProps({
          id: 'goal-progress',
          data: {
            title: 'Progress Goal',
            status: 'in_progress',
          },
        })}
      />,
    );

    const inProgressNode = screen.getByTestId('goal-flow-node-goal-progress');
    expect(inProgressNode.className).toContain('from-sky-400');
    expect(inProgressNode.className).toContain('border-[#C75B3A]');
    expect(inProgressNode.className).toContain('ring-[#C75B3A]/25');
  });
});
