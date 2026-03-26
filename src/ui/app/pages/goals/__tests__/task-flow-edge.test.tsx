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
  it('anchors single edges to the nearest points on both nodes and only bends duplicate edges in the middle', async () => {
    const { buildTaskEdgePath, resolveEdgeAnchors } = await import('../components/TaskFlowEdge');

    const anchors = resolveEdgeAnchors({
      sourceCenterX: 0,
      sourceCenterY: 0,
      sourceRadius: 20,
      targetCenterX: 120,
      targetCenterY: 40,
      targetRadius: 20,
    });

    const single = buildTaskEdgePath({
      ...anchors,
      parallelIndex: 0,
      parallelTotal: 1,
    });

    const duplicateA = buildTaskEdgePath({
      ...anchors,
      parallelIndex: 0,
      parallelTotal: 2,
    });

    const duplicateB = buildTaskEdgePath({
      ...anchors,
      parallelIndex: 1,
      parallelTotal: 2,
    });

    expect(anchors.sourceX).toBeCloseTo(18.97, 1);
    expect(anchors.sourceY).toBeCloseTo(6.32, 1);
    expect(anchors.targetX).toBeCloseTo(101.03, 1);
    expect(anchors.targetY).toBeCloseTo(33.68, 1);
    expect(single.path).toBe(`M ${anchors.sourceX} ${anchors.sourceY} L ${anchors.targetX} ${anchors.targetY}`);
    expect(duplicateA.path).toMatch(new RegExp(`^M ${anchors.sourceX} ${anchors.sourceY} C `));
    expect(duplicateB.path).toMatch(new RegExp(`^M ${anchors.sourceX} ${anchors.sourceY} C `));
    expect(duplicateA.path.endsWith(`${anchors.targetX} ${anchors.targetY}`)).toBe(true);
    expect(duplicateB.path.endsWith(`${anchors.targetX} ${anchors.targetY}`)).toBe(true);
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
            sourceCenterX: 0,
            sourceCenterY: 0,
            sourceRadius: 20,
            targetCenterX: 120,
            targetCenterY: 0,
            targetRadius: 20,
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
            sourceCenterX: 0,
            sourceCenterY: 0,
            sourceRadius: 20,
            targetCenterX: 120,
            targetCenterY: 0,
            targetRadius: 20,
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

  it('renders zombie edges with a distinct cancelled-goal visual treatment', async () => {
    const { TaskFlowEdge } = await import('../components/TaskFlowEdge');
    baseEdgeCalls.length = 0;

    render(
      <svg>
        <TaskFlowEdge
          id="edge-zombie"
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
            label: 'Zombie',
            status: 'pending',
            isZombie: true,
          }}
        />
      </svg>,
    );

    const zombieCall = baseEdgeCalls[baseEdgeCalls.length - 1] as { style: { strokeWidth: number; strokeDasharray: string; stroke: string } };
    expect(zombieCall.style.strokeDasharray).toBe('2 6');
    expect(zombieCall.style.strokeWidth).toBe(1.6);
    expect(screen.getByText('Zombie').className).toContain('opacity-60');
  });

  it('renders a strike overlay for cancelled task edges', async () => {
    const { TaskFlowEdge } = await import('../components/TaskFlowEdge');
    baseEdgeCalls.length = 0;

    render(
      <svg>
        <TaskFlowEdge
          id="edge-cancelled"
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
            label: 'Cancelled',
            status: 'cancelled',
          }}
        />
      </svg>,
    );

    expect(screen.getByTestId('task-flow-edge-cancel-strike-edge-cancelled')).toBeInTheDocument();
    expect(screen.getByText('Cancelled').className).toContain('line-through');
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

    screen.getByTestId('task-flow-edge-hit-area-edge-long-press').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 40,
      clientY: 20,
    }));

    vi.advanceTimersByTime(520);

    expect(onOpenContextMenu).toHaveBeenCalledWith('edge-long-press', 40, 20);
    vi.useRealTimers();
  });
});
