import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const baseEdgeCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@xyflow/react', () => ({
  BaseEdge: (props: Record<string, unknown>) => {
    baseEdgeCalls.push(props);
    return <div data-testid="base-edge" />;
  },
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M 0 0 L 120 0', 60, 0],
}));

describe('TaskFlowEdge', () => {
  it('renders directional markers and separates parallel edges', async () => {
    const { TaskFlowEdge } = await import('../components/TaskFlowEdge');
    baseEdgeCalls.length = 0;

    const { rerender } = render(
      <svg>
        <TaskFlowEdge
          id="edge-a"
          source="me"
          target="goal-a"
          sourceX={0}
          sourceY={0}
          sourcePosition={'right' as never}
          targetX={120}
          targetY={0}
          targetPosition={'left' as never}
          selected={false}
          data={{
            label: 'A',
            status: 'pending',
            parallelIndex: 0,
            parallelTotal: 2,
          }}
        />
      </svg>,
    );

    const firstCall = baseEdgeCalls[baseEdgeCalls.length - 1] as { path: string; markerEnd?: string };
    expect(firstCall.markerEnd).toContain('goal-task-arrow');

    rerender(
      <svg>
        <TaskFlowEdge
          id="edge-b"
          source="me"
          target="goal-a"
          sourceX={0}
          sourceY={0}
          sourcePosition={'right' as never}
          targetX={120}
          targetY={0}
          targetPosition={'left' as never}
          selected={false}
          data={{
            label: 'B',
            status: 'pending',
            parallelIndex: 1,
            parallelTotal: 2,
          }}
        />
      </svg>,
    );

    const secondCall = baseEdgeCalls[baseEdgeCalls.length - 1] as { path: string };
    expect(firstCall.path).not.toBe(secondCall.path);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('opens the edge context callback on long press', async () => {
    vi.useFakeTimers();
    const onOpenContextMenu = vi.fn();
    const { TaskFlowEdge } = await import('../components/TaskFlowEdge');

    render(
      <svg>
        <TaskFlowEdge
          id="edge-long-press"
          source="me"
          target="goal-a"
          sourceX={0}
          sourceY={0}
          sourcePosition={'right' as never}
          targetX={120}
          targetY={0}
          targetPosition={'left' as never}
          selected={false}
          data={{
            label: 'Long press',
            status: 'pending',
            onOpenContextMenu,
          }}
        />
      </svg>,
    );

    screen.getByTestId('task-flow-edge-hit-area').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 40,
      clientY: 20,
    }));

    vi.advanceTimersByTime(520);

    expect(onOpenContextMenu).toHaveBeenCalledWith('edge-long-press', 40, 20);
    vi.useRealTimers();
  });
});
