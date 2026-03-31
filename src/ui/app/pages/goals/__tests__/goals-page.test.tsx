import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskNode } from '@/lib/types/task';
import { resetGoalStoreForTests } from '../goal-store';
import { GOAL_NODE_SIZE, ME_NODE_SIZE } from '../components/GoalFlowNode';

const flowApiMocks = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
  fitView: vi.fn(),
  setCenter: vi.fn(),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
}));

const isDesktopMock = vi.hoisted(() => vi.fn(() => true));
const toastMock = vi.hoisted(() => vi.fn());
const taskServiceMocks = vi.hoisted(() => ({
  listTasks: vi.fn<() => Promise<TaskNode[]>>(async () => []),
  getTask: vi.fn<(id: string) => Promise<TaskNode | null>>(async () => null),
  onTaskChange: vi.fn<(callback: () => void) => () => void>(() => () => {}),
}));
const forceLayoutMocks = vi.hoisted(() => ({
  emitEnabled: true,
}));
const developerModeMocks = vi.hoisted(() => ({
  enabled: false,
  subscribe: vi.fn<(listener: (enabled: boolean) => void) => () => void>((listener) => {
    listener(developerModeMocks.enabled);
    return () => {};
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: toastMock,
}));

vi.mock('@/lib/services/task.service', () => ({
  getTaskService: () => taskServiceMocks,
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => isDesktopMock(),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => developerModeMocks.enabled,
  subscribeDeveloperModeChanges: developerModeMocks.subscribe,
}));

vi.mock('../goal-force-layout', () => ({
  GoalForceSimulation: class {
    private onTick: (positions: Map<string, { x: number; y: number }>) => void;

    constructor(graph: { me: { id: string }; goals: Array<{ id: string }> }, _width: number, _height: number, onTick: (positions: Map<string, { x: number; y: number }>) => void) {
      this.onTick = onTick;
      if (forceLayoutMocks.emitEnabled) {
        this.emit(graph);
      }
    }

    private emit(graph: { me: { id: string }; goals: Array<{ id: string }> }) {
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(graph.me.id, { x: 0, y: 0 });
      graph.goals.forEach((goal, index) => positions.set(goal.id, { x: 120 + index * 20, y: 120 }));
      this.onTick(positions);
    }

    updateData(graph: { me: { id: string }; goals: Array<{ id: string }> }) {
      if (forceLayoutMocks.emitEnabled) {
        this.emit(graph);
      }
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
    onInit,
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
    onInit?: (instance: {
      fitView: () => void;
      setCenter: (x: number, y: number, options?: Record<string, unknown>) => void;
      getViewport: () => { x: number; y: number; zoom: number };
    }) => void;
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
    useEffect(() => {
      onInit?.({
        fitView: flowApiMocks.fitView,
        setCenter: flowApiMocks.setCenter,
        getViewport: flowApiMocks.getViewport,
      });
    }, []);
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
            onPaneContextMenu?.({
              preventDefault: () => {},
              clientX: event.clientX,
              clientY: event.clientY,
            } as unknown as { preventDefault: () => void });
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
                onNodeContextMenu?.({
                  preventDefault: () => {},
                  clientX: event.clientX,
                  clientY: event.clientY,
                }, node);
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
              onEdgeContextMenu?.({
                preventDefault: () => {},
                clientX: event.clientX,
                clientY: event.clientY,
              }, edge);
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
  const { GoalsPage } = await import('../GoalsPage');
  const { useGoalStore } = await import('../goal-store');
  return { GoalsPage, useGoalStore };
}

describe('GoalsPage', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    resetGoalStoreForTests();
    forceLayoutMocks.emitEnabled = true;
    developerModeMocks.enabled = false;
    developerModeMocks.subscribe.mockClear();
    toastMock.mockReset();
    isDesktopMock.mockReset();
    isDesktopMock.mockReturnValue(true);
    taskServiceMocks.listTasks.mockReset();
    taskServiceMocks.getTask.mockReset();
    taskServiceMocks.onTaskChange.mockReset();
    taskServiceMocks.listTasks.mockResolvedValue([]);
    taskServiceMocks.getTask.mockResolvedValue(null);
    taskServiceMocks.onTaskChange.mockReturnValue(() => {});
    flowApiMocks.fitView.mockReset();
    flowApiMocks.setCenter.mockReset();
    flowApiMocks.getViewport.mockReset();
    flowApiMocks.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    flowApiMocks.lastProps = null;
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('creates a goal from Me context menu and opens its detail panel', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    const view = render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    expect(screen.getByText('目标详情')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')[0]).toBeInTheDocument();

    view.unmount();
  }, 15000);

  it('centers Me on first load instead of leaving it at the top-left viewport origin', async () => {
    const { GoalsPage } = await loadGoalsPage();
    render(<GoalsPage />);

    await waitFor(() => {
      expect(flowApiMocks.setCenter).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.objectContaining({
          duration: 0,
          zoom: 1,
        }),
      );
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

  it('emits suspect render warnings when visible goals lose their force-layout positions', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    forceLayoutMocks.emitEnabled = false;
    const meId = useGoalStore.getState().graph.me.id;
    act(() => {
      useGoalStore.getState().createGoal({
        fromNode: meId,
        direction: 'downstream',
      });
    });

    render(<GoalsPage />);

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('page:suspect-render-state'),
        expect.objectContaining({
          suspiciousReasons: expect.arrayContaining([
            'positions-empty-while-goals-visible',
            'missing-node-positions',
          ]),
        }),
      );
    }, { timeout: 4000 });
  }, 10000);

  it('provides explicit node handles so edges can render before DOM handle measurement completes', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const flowNodes = flowApiMocks.lastProps?.nodes as Array<{
      id: string;
      handles?: Array<{ type: string; position: string; x: number; y: number; width: number; height: number }>;
    }> | undefined;

    expect(flowNodes).toBeDefined();
    expect(flowNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'me',
          handles: expect.arrayContaining([
            expect.objectContaining({
              type: 'target',
              position: 'top',
            }),
            expect.objectContaining({
              type: 'source',
              position: 'bottom',
            }),
          ]),
        }),
      ]),
    );

    for (const node of flowNodes ?? []) {
      expect(node.handles).toHaveLength(2);
      expect(node.handles?.every((handle) => handle.x === 0 && handle.y === 0)).toBe(true);
      expect(node.handles?.every((handle) => handle.width === handle.height)).toBe(true);
    }
  });

  it('captures cascade options in the cancel goal dialog before confirming', async () => {
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

    const cascadeIn = screen.getByLabelText('同时取消入边关联的任务（达成手段）');
    const cascadeOut = screen.getByLabelText('同时取消出边关联的任务（后续路径）');
    fireEvent.click(cascadeIn);
    fireEvent.click(cascadeOut);
    fireEvent.click(screen.getByText('确认取消'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals[0]?.cancelled).toBe(true);
    });

    const opLog = useGoalStore.getState().opLog;
    const lastOp = opLog[opLog.length - 1];
    expect(lastOp?.action).toBe('cancelGoal');
    expect(lastOp?.params).toMatchObject({
      goalId,
      cascadeInTasks: true,
      cascadeOutTasks: true,
    });
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

  it('anchors the empty-state guide next to Me instead of centering it on the canvas', async () => {
    const { GoalsPage } = await loadGoalsPage();
    render(<GoalsPage />);

    await waitFor(() => {
      const guide = screen.getByTestId('goals-empty-state-guide');
      expect(guide).toHaveTextContent('右键 Me 添加你的第一个目标');
      expect(guide).toHaveStyle({
        left: '110px',
        top: '18px',
      });
    });
  });

  it('clamps the empty-state guide inside the goals page bounds', async () => {
    const { resolveEmptyStateGuidePosition } = await import('../GoalsPage');

    expect(resolveEmptyStateGuidePosition({
      meScreenRight: 250,
      meScreenCenterY: 140,
      pageWidth: 300,
      pageHeight: 160,
      detailPanelOpen: false,
      isDesktop: true,
    })).toEqual({
      left: '64px',
      top: '84px',
    });
  });

  it('keeps the empty-state guide out of the desktop detail panel area', async () => {
    const { resolveEmptyStateGuidePosition } = await import('../GoalsPage');

    expect(resolveEmptyStateGuidePosition({
      meScreenRight: 520,
      meScreenCenterY: 150,
      pageWidth: 900,
      pageHeight: 500,
      detailPanelOpen: true,
      isDesktop: true,
    })).toEqual({
      left: '308px',
      top: '126px',
    });
  });

  it('keeps the empty-state guide anchored next to Me after the viewport moves', async () => {
    const { GoalsPage } = await loadGoalsPage();
    render(<GoalsPage />);

    const onMove = flowApiMocks.lastProps?.onMove as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void);
    act(() => {
      onMove?.({}, { x: 48, y: 32, zoom: 1.5 });
    });

    await waitFor(() => {
      const guide = screen.getByTestId('goals-empty-state-guide');
      expect(guide).toHaveStyle({
        left: '200px',
        top: '71px',
      });
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

  it('positions the context menu relative to the goals page instead of raw viewport client coordinates', async () => {
    const { GoalsPage } = await loadGoalsPage();
    render(<GoalsPage />);

    const page = screen.getByTestId('goals-page');
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
      x: 24,
      y: 96,
      left: 24,
      top: 96,
      right: 1224,
      bottom: 896,
      width: 1200,
      height: 800,
      toJSON: () => '',
    });

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'), {
      clientX: 164,
      clientY: 228,
    });

    const menu = await screen.findByTestId('goal-context-menu');
    expect(menu).toHaveStyle({
      left: '140px',
      top: '132px',
    });
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

  it('splits an edge from the context menu by inserting a new midpoint goal', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    const view = render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;
    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-edge-${edgeId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-split'));

    fireEvent.change(screen.getByLabelText('中间目标标题'), { target: { value: 'Bridge' } });
    fireEvent.click(screen.getByText('确认拆解'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(2);
      expect(useGoalStore.getState().graph.edges).toHaveLength(2);
    });

    expect(useGoalStore.getState().graph.goals.map((goal) => goal.title)).toContain('Bridge');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '已拆解路径',
    }));

    view.unmount();
  });

  it('toasts when switching completion mode in goal detail panel', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    const view = render(<GoalsPage />);

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

    view.unmount();
  });

  it('rolls back goal drafts and toasts save failure when the goal freezes externally', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;

    act(() => {
      useGoalStore.getState().updateGoal({
        goalId,
        title: 'Stable Goal',
      });
    });

    const titleInput = screen.getByDisplayValue('Stable Goal');
    fireEvent.change(titleInput, { target: { value: 'Draft Goal' } });

    act(() => {
      useGoalStore.getState().setEdgeStatusOverride(edgeId, 'completed');
    });
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '保存失败',
        description: '当前目标已冻结',
      }));
      expect(screen.getByDisplayValue('Stable Goal')).toBeDisabled();
    });
  });

  it('rolls back edge drafts and toasts save failure when the target freezes externally', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;

    act(() => {
      useGoalStore.getState().updateEdge({
        edgeId,
        title: 'Stable Path',
      });
    });

    fireEvent.click(screen.getByTestId(`mock-react-flow-edge-${edgeId}`));
    const edgeTitleInput = screen.getByDisplayValue('Stable Path');
    fireEvent.change(edgeTitleInput, { target: { value: 'Draft Path' } });

    act(() => {
      useGoalStore.getState().setEdgeStatusOverride(edgeId, 'completed');
    });
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '保存失败',
        description: '当前边已冻结',
      }));
      expect(screen.getByDisplayValue('Stable Path')).toBeDisabled();
    });
  });

  it('highlights inbound edges when a goal display status changes', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    const view = render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;
    act(() => {
      useGoalStore.getState().setEdgeStatusOverride(edgeId, 'completed');
    });
    await act(async () => {
      await Promise.resolve();
    });

    const edges = flowApiMocks.lastProps?.edges as Array<{ id: string; data?: { highlighted?: boolean } }>;
    expect(edges.find((edge) => edge.id === edgeId)?.data?.highlighted).toBe(true);

    view.unmount();
  });

  it('renders an absorption overlay and pulses Me when a goal becomes completed', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    const view = render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;

    vi.useFakeTimers();
    try {
      act(() => {
        useGoalStore.getState().setEdgeStatusOverride(edgeId, 'completed');
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId(`goals-completion-absorption-${goalId}`)).toBeInTheDocument();
      const nodes = flowApiMocks.lastProps?.nodes as Array<{ id: string; data?: { isAbsorbing?: boolean } }>;
      expect(nodes.find((node) => node.id === goalId)?.data?.isAbsorbing).toBe(true);

      act(() => {
        vi.advanceTimersByTime(520);
      });

      expect(screen.queryByTestId(`goals-completion-absorption-${goalId}`)).toBeNull();
      expect(screen.getByTestId('goals-me-pulse')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(320);
      });

      expect(screen.queryByTestId('goals-me-pulse')).toBeNull();
      const settledNodes = flowApiMocks.lastProps?.nodes as Array<{ id: string; data?: { isAbsorbing?: boolean } }>;
      expect(settledNodes.find((node) => node.id === goalId)?.data?.isAbsorbing).not.toBe(true);

    } finally {
      vi.useRealTimers();
    }
    view.unmount();
  });

  it('uses bound task title and status in the graph when taskNodeRef is set', async () => {
    taskServiceMocks.listTasks.mockResolvedValue([
      {
        id: 'task-123',
        title: '真实任务',
        description: '',
        status: 'in_progress',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;

    act(() => {
      useGoalStore.getState().updateEdge({
        edgeId,
        taskNodeRef: 'task-123',
      });
    });

    await waitFor(() => {
      const edges = flowApiMocks.lastProps?.edges as Array<{ id: string; data?: { label?: string; status?: string } }>;
      const nodes = flowApiMocks.lastProps?.nodes as Array<{ id: string; data?: { status?: string } }>;

      expect(edges.find((edge) => edge.id === edgeId)?.data?.label).toBe('真实任务');
      expect(edges.find((edge) => edge.id === edgeId)?.data?.status).toBe('in_progress');
      expect(nodes.find((node) => node.id === goalId)?.data?.status).toBe('in_progress');
    });

    fireEvent.click(screen.getByTestId(`mock-react-flow-node-${goalId}`));

    expect(await screen.findByRole('button', { name: '真实任务' })).toBeInTheDocument();
  });

  it('includes the edge label in developer override toasts', async () => {
    developerModeMocks.enabled = true;
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;

    fireEvent.click(screen.getByTestId(`mock-react-flow-edge-${edgeId}`));
    fireEvent.click(await screen.findByRole('button', { name: '⚙ 开发者' }));
    fireEvent.click(screen.getByRole('button', { name: 'completed' }));

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "[开发者] 边'待定义'状态已设为 completed",
    }));
  });

  it('hides developer override controls on the page when developer mode is disabled', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const edgeId = useGoalStore.getState().graph.edges[0]?.id as string;
    fireEvent.click(screen.getByTestId(`mock-react-flow-edge-${edgeId}`));

    expect(screen.queryByRole('button', { name: '⚙ 开发者' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'completed' })).toBeNull();
  });

  it('reconnects an edge through React Flow and updates its source endpoint', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));
    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));
    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(2);
    });

    const [goalA, goalB] = useGoalStore.getState().graph.goals;
    const edgeToReconnect = useGoalStore.getState().graph.edges.find((edge) => edge.target === goalA.id);
    const onReconnect = flowApiMocks.lastProps?.onReconnect as
      | ((oldEdge: { id: string }, connection: { source?: string; target?: string }) => void)
      | undefined;

    act(() => {
      onReconnect?.(
        { id: edgeToReconnect?.id as string },
        {
          source: goalB.id,
          target: goalA.id,
        },
      );
    });

    await waitFor(() => {
      const reconnectedEdge = useGoalStore.getState().graph.edges.find((edge) => edge.id === edgeToReconnect?.id);
      expect(reconnectedEdge?.source).toBe(goalB.id);
      expect(reconnectedEdge?.target).toBe(goalA.id);
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

  it('keeps the connect preview start anchored to the source node after the viewport moves', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-me'));
    fireEvent.click(screen.getByTestId('goal-context-item-downstream'));

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(1);
    });

    const goalId = useGoalStore.getState().graph.goals[0]?.id as string;
    const onMove = flowApiMocks.lastProps?.onMove as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void);
    act(() => {
      onMove?.({}, { x: 48, y: 32, zoom: 1.5 });
    });

    fireEvent.contextMenu(screen.getByTestId(`mock-react-flow-node-${goalId}`));
    fireEvent.click(screen.getByTestId('goal-context-item-connect'));
    fireEvent.mouseMove(screen.getByTestId('goals-page'), { clientX: 360, clientY: 280 });

    const preview = screen.getByTestId('goals-connect-preview');
    const line = preview.querySelector('line');
    expect(line).not.toBeNull();
    expect(Number.parseFloat(line?.getAttribute('x1') ?? '0')).toBeCloseTo(271.5, 1);
    expect(Number.parseFloat(line?.getAttribute('y1') ?? '0')).toBeCloseTo(255.5, 1);
  });

  it('toasts when connect mode is confirmed on the same goal node', async () => {
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
    fireEvent.click(screen.getByTestId(`mock-react-flow-node-${goalId}`));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '操作失败',
        description: '不能连到自己',
      }));
    });
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

  it('sizes hop-distance rings from the actual Me-to-goal graph distance for each hop', async () => {
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

    const nodes = flowApiMocks.lastProps?.nodes as Array<{ id: string; position: { x: number; y: number } }> | undefined;
    const meNode = nodes?.find((node) => node.id === 'me');
    const firstGoalNode = nodes?.find((node) => node.id === firstGoalId);
    const secondGoalId = useGoalStore.getState().graph.goals[1]?.id as string;
    const secondGoalNode = nodes?.find((node) => node.id === secondGoalId);
    expect(meNode).toBeDefined();
    expect(firstGoalNode).toBeDefined();
    expect(secondGoalNode).toBeDefined();
    if (!meNode || !firstGoalNode || !secondGoalNode) {
      throw new Error('expected Me and two goal nodes for hop ring distance assertions');
    }

    const meCenter = {
      x: meNode.position.x + ME_NODE_SIZE / 2,
      y: meNode.position.y + ME_NODE_SIZE / 2,
    };
    const firstHopDistance = Math.hypot(
      firstGoalNode.position.x + GOAL_NODE_SIZE / 2 - meCenter.x,
      firstGoalNode.position.y + GOAL_NODE_SIZE / 2 - meCenter.y,
    );
    const secondHopDistance = Math.hypot(
      secondGoalNode.position.x + GOAL_NODE_SIZE / 2 - meCenter.x,
      secondGoalNode.position.y + GOAL_NODE_SIZE / 2 - meCenter.y,
    );

    const ring1Radius = Number(screen.getByTestId('goals-hop-ring-1').querySelector('circle')?.getAttribute('r'));
    const ring2Radius = Number(screen.getByTestId('goals-hop-ring-2').querySelector('circle')?.getAttribute('r'));

    expect(ring1Radius).toBeCloseTo(firstHopDistance, 3);
    expect(ring2Radius).toBeCloseTo(secondHopDistance, 3);
  });

  it('keeps hop-distance rings aligned with the React Flow viewport transform', async () => {
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

    const onMove = flowApiMocks.lastProps?.onMove as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void);
    act(() => {
      onMove?.({}, { x: 48, y: 32, zoom: 1.5 });
    });

    expect(screen.getByTestId('goals-hop-rings')).toHaveStyle({
      transform: 'translate(48px, 32px) scale(1.5)',
      transformOrigin: '0 0',
    });
  });

  it('keeps Me centered when the graph grows instead of auto-fitting the viewport away from Me', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);
    const meId = useGoalStore.getState().graph.me.id;
    let firstGoalId = '';

    await waitFor(() => {
      expect(flowApiMocks.setCenter).toHaveBeenCalled();
    });

    act(() => {
      const firstResult = useGoalStore.getState().createGoal({
        fromNode: meId,
        direction: 'downstream',
      });
      expect(firstResult.ok).toBe(true);
      if (firstResult.ok) {
        firstGoalId = firstResult.value.goal.id;
      }
    });

    act(() => {
      const secondResult = useGoalStore.getState().createGoal({
        fromNode: firstGoalId,
        direction: 'downstream',
      });
      expect(secondResult.ok).toBe(true);
    });

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(2);
    });

    expect(flowApiMocks.fitView).not.toHaveBeenCalled();
    expect(flowApiMocks.setCenter).toHaveBeenCalled();
  });

  it('renders concentric hop rings without overlapping labels or clipped glow fill', async () => {
    const { GoalsPage, useGoalStore } = await loadGoalsPage();
    render(<GoalsPage />);
    const meId = useGoalStore.getState().graph.me.id;
    let firstGoalId = '';

    act(() => {
      const firstResult = useGoalStore.getState().createGoal({
        fromNode: meId,
        direction: 'downstream',
      });
      expect(firstResult.ok).toBe(true);
      if (firstResult.ok) {
        firstGoalId = firstResult.value.goal.id;
      }
    });

    act(() => {
      const secondResult = useGoalStore.getState().createGoal({
        fromNode: firstGoalId,
        direction: 'downstream',
      });
      expect(secondResult.ok).toBe(true);
    });

    await waitFor(() => {
      expect(useGoalStore.getState().graph.goals).toHaveLength(2);
    });

    const rings = screen.getByTestId('goals-hop-rings');
    expect(rings.querySelector('circle[fill^="url("]')).toBeNull();

    const ring1 = screen.getByTestId('goals-hop-ring-1');
    const ring2 = screen.getByTestId('goals-hop-ring-2');
    const ring1Circle = ring1.querySelector('circle');
    const ring2Circle = ring2.querySelector('circle');
    const ring1Label = within(ring1).getByText('1 跳');
    const ring2Label = within(ring2).getByText('2 跳');

    expect(ring1Circle).toHaveAttribute('fill', 'none');
    expect(ring2Circle).toHaveAttribute('fill', 'none');
    expect(ring1Circle).toHaveAttribute('cx', ring2Circle?.getAttribute('cx') ?? '');
    expect(ring1Circle).toHaveAttribute('cy', ring2Circle?.getAttribute('cy') ?? '');
    expect(ring1Label.parentElement?.getAttribute('transform')).not.toBe(ring2Label.parentElement?.getAttribute('transform'));
  });
});
