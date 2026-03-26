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
  it('keeps a single edge straight and only bends duplicate edges', async () => {
    const { buildTaskEdgePath } = await import('../components/TaskFlowEdge');

    const single = buildTaskEdgePath({
      sourceX: 0,
      sourceY: 0,
      targetX: 120,
      targetY: 40,
      parallelIndex: 0,
      parallelTotal: 1,
    });

    const duplicateA = buildTaskEdgePath({
      sourceX: 0,
      sourceY: 0,
      targetX: 120,
      targetY: 40,
      parallelIndex: 0,
      parallelTotal: 2,
    });

    const duplicateB = buildTaskEdgePath({
      sourceX: 0,
      sourceY: 0,
      targetX: 120,
      targetY: 40,
      parallelIndex: 1,
      parallelTotal: 2,
    });

    expect(single.path).toBe('M 0 0 L 120 40');
    expect(duplicateA.path).toMatch(/^M 0 0 C /);
    expect(duplicateB.path).toMatch(/^M 0 0 C /);
    expect(duplicateA.path.endsWith('120 40')).toBe(true);
    expect(duplicateB.path.endsWith('120 40')).toBe(true);
  });

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

  it('renders empty-slot pending edges thinner than task-backed pending edges', async () => {
    const { TaskFlowEdge } = await import('../components/TaskFlowEdge');
    baseEdgeCalls.length = 0;

    const { rerender } = render(
      <svg>
        <TaskFlowEdge
          id="edge-empty-slot"
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
            label: '待定义',
            status: 'pending',
            isEmptySlot: true,
          }}
        />
      </svg>,
    );

    const emptySlotCall = baseEdgeCalls[baseEdgeCalls.length - 1] as { style: { strokeWidth: number; strokeDasharray: string } };

    rerender(
      <svg>
        <TaskFlowEdge
          id="edge-task-backed"
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
            label: '任务 A',
            status: 'pending',
            isEmptySlot: false,
          }}
        />
      </svg>,
    );

    const taskBackedCall = baseEdgeCalls[baseEdgeCalls.length - 1] as { style: { strokeWidth: number; strokeDasharray: string } };
    expect(emptySlotCall.style.strokeDasharray).toBe('4 5');
    expect(taskBackedCall.style.strokeDasharray).toBe('6 4');
    expect(emptySlotCall.style.strokeWidth).toBeLessThan(taskBackedCall.style.strokeWidth);
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
