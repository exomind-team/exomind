import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

function buildNodeProps(
  GoalFlowNode: (props: ComponentProps<any>) => JSX.Element,
  overrides: Partial<ComponentProps<typeof GoalFlowNode>>,
): ComponentProps<typeof GoalFlowNode> {
  return {
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
  };
}

describe('GoalFlowNode', () => {
  it('renders pending goals with the default cool gradient and in-progress goals with amber emphasis', async () => {
    const { GoalFlowNode } = await import('../components/GoalFlowNode');

    const { rerender } = render(
      <GoalFlowNode
        {...buildNodeProps(GoalFlowNode, {
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
        {...buildNodeProps(GoalFlowNode, {
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
    expect(screen.getByTestId('goal-flow-node-progress-pulse-goal-progress')).toBeInTheDocument();
  });

  it('renders empty titles as a softened placeholder instead of a normal title label', async () => {
    const { GoalFlowNode } = await import('../components/GoalFlowNode');

    render(
      <GoalFlowNode
        {...buildNodeProps(GoalFlowNode, {
          id: 'goal-empty-title',
          data: {
            title: '',
            status: 'pending',
          },
        })}
      />,
    );

    const placeholder = screen.getByText('待命名');
    expect(placeholder.className).toContain('italic');
    expect(placeholder.className).toContain('opacity-75');
  });

  it('opens the node context callback on long press', async () => {
    vi.useFakeTimers();
    const { GoalFlowNode } = await import('../components/GoalFlowNode');
    const onOpenContextMenu = vi.fn();

    render(
      <GoalFlowNode
        {...buildNodeProps(GoalFlowNode, {
          id: 'goal-long-press',
          data: {
            title: 'Long Press Goal',
            status: 'pending',
            onOpenContextMenu,
          },
        })}
      />,
    );

    const node = screen.getByTestId('goal-flow-node-goal-long-press');
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 40 }));
    vi.advanceTimersByTime(550);

    expect(onOpenContextMenu).toHaveBeenCalledWith('goal-long-press', 30, 40);
    vi.useRealTimers();
  });

  it('cancels node long press when the pointer moves beyond tolerance', async () => {
    vi.useFakeTimers();
    const { GoalFlowNode } = await import('../components/GoalFlowNode');
    const onOpenContextMenu = vi.fn();

    render(
      <GoalFlowNode
        {...buildNodeProps(GoalFlowNode, {
          id: 'goal-cancel-long-press',
          data: {
            title: 'Move Goal',
            status: 'pending',
            onOpenContextMenu,
          },
        })}
      />,
    );

    const node = screen.getByTestId('goal-flow-node-goal-cancel-long-press');
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }));
    node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 20 }));
    vi.advanceTimersByTime(550);

    expect(onOpenContextMenu).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
