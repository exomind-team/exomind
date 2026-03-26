import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const flowApiMocks = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

const isDesktopMock = vi.hoisted(() => vi.fn(() => true));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/toast-hook', () => ({
  toast: toastMock,
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => isDesktopMock(),
}));

vi.mock('../goal-force-layout', () => ({
  GoalForceSimulation: class {
    private onTick: (positions: Map<string, { x: number; y: number }>) => void;

    constructor(graph: { me: { id: string }; goals: Array<{ id: string }> }, _width: number, _height: number, onTick: (positions: Map<string, { x: number; y: number }>) => void) {
      this.onTick = onTick;
      this.emit(graph);
    }

    private emit(graph: { me: { id: string }; goals: Array<{ id: string }> }) {
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(graph.me.id, { x: 0, y: 0 });
      graph.goals.forEach((goal, index) => positions.set(goal.id, { x: 120 + index * 20, y: 120 }));
      this.onTick(positions);
    }

    updateData(graph: { me: { id: string }; goals: Array<{ id: string }> }) {
      this.emit(graph);
    }

    pinNode() {}
    releaseNode() {}
    reheat() {}
    destroy() {}
  },
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onPaneClick,
    onPaneContextMenu,
    onNodeClick,
    onNodeContextMenu,
    onEdgeClick,
    onEdgeContextMenu,
    nodeTypes,
    ...props
  }: {
    nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    edges?: Array<{ id: string }>;
    children?: ReactNode;
    onPaneClick?: () => void;
    onPaneContextMenu?: (_event: { preventDefault: () => void }) => void;
    onNodeClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeContextMenu?: (_event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string; data?: Record<string, unknown> }) => void;
    onEdgeClick?: (_event: unknown, edge: { id: string }) => void;
    onEdgeContextMenu?: (_event: { preventDefault: () => void; clientX: number; clientY: number }, edge: { id: string }) => void;
    nodeTypes?: Record<string, (props: { id: string; data: Record<string, unknown> }) => JSX.Element>;
    [key: string]: unknown;
  }) => {
    flowApiMocks.lastProps = { ...props, nodes, edges };
    return (
      <div data-testid="mock-react-flow">
        <button type="button" data-testid="mock-react-flow-pane" onClick={() => onPaneClick?.()}>
          pane
        </button>
        <button
          type="button"
          data-testid="mock-react-flow-pane-context"
          onContextMenu={(event) => {
            event.preventDefault();
            onPaneContextMenu?.({ preventDefault: () => {} });
          }}
        >
          pane-context
        </button>
        {(nodes ?? []).map((node) => {
          const NodeComponent = node.type ? nodeTypes?.[node.type] : undefined;
          return (
            <button
              key={node.id}
              type="button"
              data-testid={`mock-react-flow-node-${node.id}`}
              onClick={() => onNodeClick?.({}, node)}
              onContextMenu={(event) => {
                event.preventDefault();
                onNodeContextMenu?.({ preventDefault: () => {}, clientX: 32, clientY: 48 }, node);
              }}
            >
              {NodeComponent ? <NodeComponent id={node.id} data={node.data ?? {}} /> : node.id}
            </button>
          );
        })}
        {(edges ?? []).map((edge) => (
          <button
            key={edge.id}
            type="button"
            data-testid={`mock-react-flow-edge-${edge.id}`}
            onClick={() => onEdgeClick?.({}, edge)}
            onContextMenu={(event) => {
              event.preventDefault();
              onEdgeContextMenu?.({ preventDefault: () => {}, clientX: 64, clientY: 72 }, edge);
            }}
          >
            {edge.id}
          </button>
        ))}
        {children}
      </div>
    );
  },
  Background: () => <div data-testid="mock-react-flow-background" />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M 0 0 L 1 1', 10, 10],
}));

async function loadGoalsPage() {
  vi.resetModules();
  const { GoalsPage } = await import('../GoalsPage');
  const { useGoalStore } = await import('../goal-store');
  return { GoalsPage, useGoalStore };
}

describe('GoalsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    toastMock.mockReset();
    isDesktopMock.mockReset();
    isDesktopMock.mockReturnValue(true);
  });

  it('creates a goal from Me context menu and saves title from detail panel', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const titleInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'First goal' } });
    fireEvent.blur(titleInput);

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals[0]?.title).toBe('First goal');
    });
  });

  it('hides cancelled goals by default and shows them when toggle is enabled', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-node-${goalId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-cancel'));
    fireEvent.click(screen.getByText('确认取消'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals[0]?.cancelled).toBe(true);
    });

    expect(screen.queryByTestId(`mock-react-flow-node-${goalId}`)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByTestId(`mock-react-flow-node-${goalId}`)).toBeInTheDocument();
  });

  it('uses touch-first empty-state copy on mobile and lets Me name be edited', async () => {
    isDesktopMock.mockReturnValue(false);
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    expect(screen.getByText('长按 Me 添加你的第一个目标')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-me'));

    const nameInput = await screen.findByDisplayValue('Me');
    fireEvent.change(nameInput, { target: { value: 'Core Self' } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(useGoalStore.getState().graph.me.name).toBe('Core Self');
    });
  });

  it('limits completed goal context menu to read-only actions', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    const inboundEdgeId = useGoalStore.getState().graph.edges[0]?.id as string;
    act(() => {
      useGoalStore.getState().setEdgeStatusOverride(inboundEdgeId, 'completed');
    });

    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-node-${goalId}`));

    expect(screen.getByTestId('goal-context-item-detail')).toBeInTheDocument();
    expect(screen.getByTestId('goal-context-item-downstream')).toBeInTheDocument();
    expect(screen.getByTestId('goal-context-item-connect')).toBeInTheDocument();
    expect(screen.queryByTestId('goal-context-item-upstream')).toBeNull();
    expect(screen.queryByTestId('goal-context-item-cancel')).toBeNull();
  });

  it('shows C5 feedback when deleting the last inbound edge', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;
    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-edge-${edgeId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-delete'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '已自动添加连接以保持目标可达',
      }));
    });
  });

  it('toasts when switching completion mode in goal detail panel', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'OR' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '完成条件已更新为 OR',
      }));
    });
  });

  it('shows connect preview while connect mode is active and clears it on pane click', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-node-${goalId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-connect'));

    fireEvent.mouseMove(screen.getByTestId('goals-page'), { clientX: 240, clientY: 180 });

    expect(screen.getByTestId('goals-connect-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-pane'));

    expect(screen.queryByTestId('goals-connect-preview')).toBeNull();
  });

  it('passes parallel edge metadata to duplicate edges', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    act(() => {
      useGoalStore.getState().createEdge({
        source: 'me',
        target: goalId,
        rulePosition: { clauseIndex: 0 },
      });
    });

    await waitFor(() => {
      const edges = flowApiMocks.lastProps?.edges as Array<{ data?: { parallelIndex?: number; parallelTotal?: number } }>;
      expect(edges).toHaveLength(2);
      expect(edges.map((edge) => edge.data?.parallelTotal)).toEqual([2, 2]);
      expect(edges.map((edge) => edge.data?.parallelIndex)).toEqual([0, 1]);
    });
  });

  it('renders hop-distance rings around Me when the graph extends outward', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const firstGoalId = useGoalStore.getState().graph.goals[0]?.id as string;
    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-node-${firstGoalId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(2);
    });

    expect(screen.getByTestId('goals-hop-rings')).toBeInTheDocument();
    expect(screen.getByTestId('goals-hop-ring-1')).toBeInTheDocument();
    expect(screen.getByTestId('goals-hop-ring-2')).toBeInTheDocument();
  });
});
