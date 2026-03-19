import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDagPage } from '@/ui/app/pages/TaskDagPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const onTaskChangeMock = vi.fn(() => () => {});
const createTaskMock = vi.fn();
const addDependencyMock = vi.fn();
const removeDependencyMock = vi.fn();
const transitionTaskMock = vi.fn();
const loadActiveBlockMock = vi.fn();
const onBlockChangeMock = vi.fn(() => () => {});
const markEndingMock = vi.fn();
const endBlockMock = vi.fn();
const startBlockForTaskMock = vi.fn();
const calculateSpentMinutesMock = vi.fn();
const addTaskToBlockMock = vi.fn();
const removeTaskFromBlockMock = vi.fn();
const onBlockEndForTasksMock = vi.fn();

const flowApiMocks = vi.hoisted(() => ({
  setCenter: vi.fn(),
  fitView: vi.fn(),
  setViewport: vi.fn(),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 0.12 })),
  getNode: vi.fn(),
  lastProps: null as null | Record<string, unknown>,
}));

const navigateMock = vi.hoisted(() => vi.fn());
const isDesktopMock = vi.hoisted(() => vi.fn(() => true));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/tasks/dag', searchStr: '' }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    onTaskChange: onTaskChangeMock,
    createTask: createTaskMock,
    addDependency: addDependencyMock,
    removeDependency: removeDependencyMock,
    transitionTask: transitionTaskMock,
  }),
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    markEnding: markEndingMock,
    endBlock: endBlockMock,
  }),
  getTaskTimerService: () => ({
    startBlockForTask: startBlockForTaskMock,
    calculateSpentMinutes: calculateSpentMinutesMock,
    addTaskToBlock: addTaskToBlockMock,
    removeTaskFromBlock: removeTaskFromBlockMock,
    onBlockEndForTasks: onBlockEndForTasksMock,
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: toastMock,
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onPaneClick,
    onPaneDoubleClick,
    onPaneContextMenu,
    onNodeClick,
    onNodeDoubleClick,
    onNodeContextMenu,
    nodeTypes,
    onInit,
    ...props
  }: {
    nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    edges?: Array<{ id: string }>;
    children?: ReactNode;
    onPaneClick?: (event: { shiftKey?: boolean }) => void;
    onPaneDoubleClick?: () => void;
    onPaneContextMenu?: (_event: { preventDefault: () => void; clientX: number; clientY: number }) => void;
    onNodeClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeDoubleClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeContextMenu?: (_event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string; data?: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, (props: { id: string; data: Record<string, unknown> }) => JSX.Element>;
    onInit?: (instance: {
      setCenter: typeof flowApiMocks.setCenter;
      fitView: typeof flowApiMocks.fitView;
      setViewport: typeof flowApiMocks.setViewport;
      getViewport: typeof flowApiMocks.getViewport;
      getNode: typeof flowApiMocks.getNode;
    }) => void;
    [key: string]: unknown;
  }) => {
    flowApiMocks.lastProps = {
      ...props,
      nodes,
      edges,
    };
    onInit?.(flowApiMocks);
    return (
      <div data-testid="mock-react-flow">
        <button type="button" data-testid="mock-react-flow-pane" onClick={(event) => onPaneClick?.(event)}>
          pane
        </button>
        <button type="button" data-testid="mock-react-flow-pane-double" onDoubleClick={() => onPaneDoubleClick?.()}>
          pane-double
        </button>
        <button
          type="button"
          data-testid="mock-react-flow-pane-context"
          onContextMenu={(event) => {
            event.preventDefault();
            onPaneContextMenu?.({ preventDefault: () => {}, clientX: 96, clientY: 128 });
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
              onDoubleClick={() => onNodeDoubleClick?.({}, node)}
              onContextMenu={(event) => {
                event.preventDefault();
                onNodeContextMenu?.({ preventDefault: () => {}, clientX: 32, clientY: 48 }, node);
              }}
            >
              {NodeComponent ? (
                <NodeComponent
                  id={node.id}
                  data={node.data ?? {}}
                  sourcePosition={node.sourcePosition}
                  targetPosition={node.targetPosition}
                />
              ) : node.id}
            </button>
          );
        })}
        {(edges ?? []).map((edge) => (
          <div key={edge.id} data-testid={`mock-react-flow-edge-${edge.id}`}>{edge.id}</div>
        ))}
        {children}
      </div>
    );
  },
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => isDesktopMock(),
}));

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('TaskDagPage issue-394（任务 DAG Wave 1 / Wave 2 / Wave 3）', () => {
  beforeEach(() => {
    flowApiMocks.setCenter.mockReset();
    flowApiMocks.fitView.mockReset();
    flowApiMocks.setViewport.mockReset();
    flowApiMocks.getViewport.mockClear();
    flowApiMocks.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.12 });
    flowApiMocks.getNode.mockReset();
    flowApiMocks.lastProps = null;
    navigateMock.mockReset();
    isDesktopMock.mockReset();
    isDesktopMock.mockReturnValue(true);
    toastMock.mockReset();
    listTasksMock.mockReset();
    onTaskChangeMock.mockClear();
    createTaskMock.mockReset();
    addDependencyMock.mockReset();
    removeDependencyMock.mockReset();
    transitionTaskMock.mockReset();
    loadActiveBlockMock.mockReset();
    onBlockChangeMock.mockClear();
    markEndingMock.mockReset();
    endBlockMock.mockReset();
    startBlockForTaskMock.mockReset();
    calculateSpentMinutesMock.mockReset();
    addTaskToBlockMock.mockReset();
    removeTaskFromBlockMock.mockReset();
    onBlockEndForTasksMock.mockReset();

    loadActiveBlockMock.mockResolvedValue(null);
    markEndingMock.mockResolvedValue(undefined);
    endBlockMock.mockResolvedValue(null);
    startBlockForTaskMock.mockResolvedValue(null);
    calculateSpentMinutesMock.mockResolvedValue(0);
    addTaskToBlockMock.mockResolvedValue(undefined);
    removeTaskFromBlockMock.mockResolvedValue(undefined);
    onBlockEndForTasksMock.mockResolvedValue(undefined);
    transitionTaskMock.mockResolvedValue(null);
    createTaskMock.mockResolvedValue(null);
    addDependencyMock.mockResolvedValue(null);
    removeDependencyMock.mockResolvedValue(null);
    window.localStorage.clear();

    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '梳理 DAG 基础层', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '接入任务列表引导',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({
        id: 'task-c',
        title: '补充详情页提示',
        status: 'completed',
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [{ taskId: 'task-a', type: 'soft' }],
      }),
    ]);
  });

  it('renders full-canvas workspace with floating controls and three enabled modes', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-dag-page')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-canvas-shell')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-mode-browse')).toBeEnabled();
    expect(screen.getByTestId('task-dag-mode-connect')).toBeEnabled();
    expect(screen.getByTestId('task-dag-mode-execute')).toBeEnabled();
    expect(screen.getByTestId('task-dag-legend-hard-chip')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-soft-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-current-root-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-current-root-badge-task-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-selected-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-a').className).toContain('border-[#16A34A]/60');

    fireEvent.click(screen.getByTestId('task-dag-jump-to-root'));
    expect(flowApiMocks.setCenter).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), {
      duration: 250,
      zoom: 0.12,
    });
  });

  it('allows fit view to zoom out below the old lower bound', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(flowApiMocks.lastProps).toMatchObject({
      fitView: true,
      minZoom: 0.01,
      fitViewOptions: {
        padding: 0.2,
        minZoom: 0.01,
      },
    });
    expect(flowApiMocks.fitView).toHaveBeenCalledWith({
      padding: 0.2,
      minZoom: 0.01,
    });
  });

  it('switches dag direction, persists selection, and re-fits the viewport', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    const fitViewCallCountBeforeChange = flowApiMocks.fitView.mock.calls.length;
    fireEvent.click(screen.getByTestId('task-dag-direction-tb'));

    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:dag-direction')).toBe('TB');
      expect(flowApiMocks.fitView.mock.calls.length).toBeGreaterThan(fitViewCallCountBeforeChange);
    });
    expect(flowApiMocks.fitView).toHaveBeenLastCalledWith({
      padding: 0.2,
      minZoom: 0.01,
    });

    const lastProps = flowApiMocks.lastProps as {
      nodes: Array<{ sourcePosition: string; targetPosition: string }>;
      edges: Array<{ type: string }>;
    };
    expect(lastProps.nodes[0]).toMatchObject({
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
    expect(lastProps.edges[0]).toMatchObject({ type: 'default' });
  });

  it('uses top-bottom auto layout on mobile viewports', async () => {
    isDesktopMock.mockReturnValue(false);
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    const lastProps = flowApiMocks.lastProps as {
      nodes: Array<{ sourcePosition: string; targetPosition: string }>;
    };
    expect(window.localStorage.getItem('exomind:dag-direction')).toBe('auto');
    expect(lastProps.nodes[0]).toMatchObject({
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
  });

  it('highlights the selected node instead of showing the old side panel', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-node-task-b').className).toContain('ring-[#C75B3A]/35');
    });
    expect(screen.queryByTestId('task-dag-selected-panel')).not.toBeInTheDocument();
  });

  it('opens the desktop detail panel on node click and shows dependency details', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));

    const detailPanel = await screen.findByTestId('task-dag-detail-panel-desktop');
    expect(detailPanel).toBeInTheDocument();
    expect(within(detailPanel).getByText('接入任务列表引导')).toBeInTheDocument();
    expect(within(detailPanel).getByText('该任务目前仍被前置任务阻塞，需先完成对应依赖后才能启动。')).toBeInTheDocument();
    expect(within(detailPanel).getByTestId('task-dag-detail-upstream-list')).toHaveTextContent('梳理 DAG 基础层');
    expect(within(detailPanel).getByText('当前节点没有后继依赖。')).toBeInTheDocument();
  });

  it('closes the detail panel on pane click and close button', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(await screen.findByTestId('task-dag-detail-panel-desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-detail-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-detail-panel-desktop')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(await screen.findByTestId('task-dag-detail-panel-desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-pane'));
    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-detail-panel-desktop')).not.toBeInTheDocument();
    });
  });

  it('renders the mobile drawer variant when the viewport is not desktop', async () => {
    isDesktopMock.mockReturnValue(false);
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    expect(await screen.findByTestId('task-dag-detail-panel-mobile')).toBeInTheDocument();
  });

  it('navigates to task detail with dag source on node double click and panel action', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.doubleClick(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/tasks/$taskId',
      params: { taskId: 'task-a' },
      search: { from: 'dag' },
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    expect(await screen.findByTestId('task-dag-detail-open-task')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-detail-open-task'));
    expect(navigateMock).toHaveBeenLastCalledWith({
      to: '/tasks/$taskId',
      params: { taskId: 'task-b' },
      search: { from: 'dag' },
    });
  });

  it('filters completed nodes when hide terminal is enabled', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-c')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-hide-terminal-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-c')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('1');
    expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
  });

  it('restores hide-terminal and immersive preferences from localStorage on first render', async () => {
    window.localStorage.setItem('exomind:dag-hide-terminal', '1');
    window.localStorage.setItem('exomind:dag-immersive', '1');

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-react-flow-node-task-c')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-dag-page-header')).toHaveClass('hidden');
    expect(screen.queryByTestId('mock-react-flow-controls')).not.toBeInTheDocument();
  });

  it('highlights search matches and fades unmatched nodes', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('task-dag-search-input'), { target: { value: '引导' } });
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-match-count')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-node-task-a').className).toContain('opacity-35');
    });
    expect(screen.getByTestId('task-dag-node-task-b').className).toContain('ring-[#C75B3A]/35');
  });

  it('switches modes and persists the latest mode to localStorage', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('connect');
    expect(screen.getByText(/连接模式：/)).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-mode-active-indicator')).toHaveStyle({
      transform: 'translateX(100%)',
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('execute');
    expect(screen.getByText(/执行模式：/)).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-mode-active-indicator')).toHaveStyle({
      transform: 'translateX(200%)',
    });
  });

  it('supports keyboard mode switching, escape cleanup, and pan shortcuts from the centralized dag hook', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('connect');

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(screen.getByText('准备硬依赖')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('准备硬依赖')).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('execute');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(flowApiMocks.setViewport).toHaveBeenCalledWith({
      x: 40,
      y: 0,
      zoom: 0.12,
    });
  });

  it('renders dynamic key hints and hides them in immersive mode', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-key-hints')).toBeInTheDocument();
    });

    expect(screen.getByText('切换模式')).toBeInTheDocument();
    expect(screen.getAllByText('平移画布')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    await waitFor(() => {
      expect(screen.getByText('导航节点')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    expect(screen.getByText('设为连接起点')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    await waitFor(() => {
      expect(screen.getByText('取消连接')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-immersive-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-key-hints')).not.toBeInTheDocument();
    });
  });

  it('supports connect mode dependency toggle rules and surfaces cycle rejection', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(screen.getByText('准备硬依赖')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    await waitFor(() => {
      expect(removeDependencyMock).toHaveBeenCalledWith('task-b', 'task-a');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(screen.getByText('准备软依赖')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-b', 'task-a', 'soft');
    });

    addDependencyMock.mockRejectedValueOnce(new Error('Adding dependency task-a → task-b would create a cycle'));

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: '依赖更新失败',
        description: '不允许循环依赖',
        variant: 'destructive',
      }));
    });
  });

  it('supports enter cycling for keyboard-driven connect mode source selection', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByText('准备硬依赖')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByText('准备软依赖')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByText('准备硬依赖')).not.toBeInTheDocument();
      expect(screen.queryByText('准备软依赖')).not.toBeInTheDocument();
    });
  });

  it('disables double-click navigation while in connect mode to avoid conflicting with soft dependency gestures', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    fireEvent.doubleClick(screen.getByTestId('mock-react-flow-node-task-a'));

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('toggles immersive mode and hides page chrome plus flow controls', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    expect(screen.getByTestId('task-dag-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('mock-react-flow-controls')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-immersive-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-page-header')).toHaveClass('hidden');
    });
    expect(window.localStorage.getItem('exomind:dag-immersive')).toBe('1');
    expect(screen.queryByTestId('mock-react-flow-controls')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-page-header')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('exomind:dag-immersive')).toBe('0');
    expect(screen.getByTestId('mock-react-flow-controls')).toBeInTheDocument();
  });

  it('opens quick create from pane gestures in connect mode and submits a new task', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.doubleClick(screen.getByTestId('mock-react-flow-pane-double'));
    expect(screen.queryByTestId('task-quick-create-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    fireEvent.doubleClick(screen.getByTestId('mock-react-flow-pane-double'));

    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '连接模式新增任务' } });
    fireEvent.change(screen.getByTestId('task-quick-create-description'), { target: { value: '由测试创建' } });
    fireEvent.click(screen.getByTestId('task-quick-create-submit'));

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith({
        title: '连接模式新增任务',
        description: '由测试创建',
      });
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: '任务已创建',
      description: '连接模式新增任务',
    });

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-pane-context'));
    expect(await screen.findByTestId('task-dag-pane-context-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-dag-pane-context-create'));
    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
  });

  it('creates dependency-aware quick tasks from pane click in connect mode, including upstream reversal', async () => {
    createTaskMock
      .mockResolvedValueOnce(makeTask({ id: 'task-new-downstream', title: '连接模式下游任务' }))
      .mockResolvedValueOnce(makeTask({ id: 'task-new-upstream', title: '连接模式上游任务' }));

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('mock-react-flow-pane'));

    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '连接模式下游任务' } });
    fireEvent.click(screen.getByTestId('task-quick-create-submit'));

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-new-downstream', 'task-a', 'hard');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('mock-react-flow-pane'), { shiftKey: true });

    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '连接模式上游任务' } });
    fireEvent.click(screen.getByTestId('task-quick-create-submit'));

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-a', 'task-new-upstream', 'soft');
    });
  });

  it('supports keyboard quick-create shortcuts and Ctrl+Enter submission in connect mode', async () => {
    createTaskMock
      .mockResolvedValueOnce(makeTask({ id: 'task-keyboard-downstream', title: '键盘下游任务' }))
      .mockResolvedValueOnce(makeTask({ id: 'task-keyboard-upstream', title: '键盘上游任务' }));

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '键盘下游任务' } });
    fireEvent.change(screen.getByTestId('task-quick-create-description'), { target: { value: '使用 Ctrl+Enter 提交' } });
    fireEvent.keyDown(screen.getByTestId('task-quick-create-description'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-keyboard-downstream', 'task-a', 'hard');
    });

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '键盘上游任务' } });
    fireEvent.change(screen.getByTestId('task-quick-create-description'), { target: { value: '再次用快捷键提交' } });
    fireEvent.keyDown(screen.getByTestId('task-quick-create-title'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-a', 'task-keyboard-upstream', 'hard');
    });
  });

  it('starts executable tasks in execute mode with remaining countdown config', async () => {
    calculateSpentMinutesMock.mockResolvedValue(15);
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '可执行任务', estimatedMinutes: 40, createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '受阻任务',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-a', { mode: 'countdown', minutes: 25 });
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    expect(startBlockForTaskMock).toHaveBeenCalledTimes(1);
  });

  it('opens the multi-task end dialog in execute mode and submits task outcomes', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '进行中的任务', status: 'in_progress', createdAt: 10, updatedAt: 10 }),
      makeTask({ id: 'task-b', title: '可追加任务', createdAt: 20, updatedAt: 20 }),
    ]);
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-a'],
      taskAssociationLog: [],
    });

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-b');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    await waitFor(() => {
      expect(markEndingMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('task-dag-end-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-dag-end-dialog-feedback'), { target: { value: '总结反馈' } });
    fireEvent.click(screen.getByTestId('feedback-task-status-completed'));
    fireEvent.click(screen.getByTestId('task-dag-end-dialog-submit'));

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('总结反馈', {
        taskStatusOutcomes: { 'task-a': 'completed' },
        taskTitles: { 'task-a': '进行中的任务' },
      });
    });
    expect(onBlockEndForTasksMock).toHaveBeenCalledWith(['task-a'], 'block-1');
    expect(transitionTaskMock).toHaveBeenCalledWith('task-a', 'completed');
  });

  it('opens a status dialog before removing one task from a multi-task active block', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '进行中的任务 A', status: 'in_progress', createdAt: 10, updatedAt: 10 }),
      makeTask({ id: 'task-b', title: '进行中的任务 B', status: 'in_progress', createdAt: 20, updatedAt: 20 }),
      makeTask({ id: 'task-c', title: '可追加任务', createdAt: 30, updatedAt: 30 }),
    ]);
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-2',
      name: '多任务时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-a', 'task-b'],
      taskAssociationLog: [],
    });

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    expect(await screen.findByTestId('task-dag-disassociate-dialog')).toBeInTheDocument();
    expect(removeTaskFromBlockMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('task-dag-disassociate-status-completed'));
    fireEvent.click(screen.getByTestId('task-dag-disassociate-submit'));

    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-a');
    });
    expect(transitionTaskMock).toHaveBeenCalledWith('task-a', 'completed');
  });

  it('shows disabled upstream/downstream actions in the context menu when a node cannot be safely folded', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: 'A', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: 'B',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({
        id: 'task-y',
        title: 'Y',
        createdAt: 25,
        updatedAt: 25,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({ id: 'task-x', title: 'X', createdAt: 15, updatedAt: 15 }),
      makeTask({
        id: 'task-c',
        title: 'C',
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [
          { taskId: 'task-b', type: 'hard' },
          { taskId: 'task-x', type: 'hard' },
        ],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByTestId('mock-react-flow-node-task-b'));

    expect(await screen.findByTestId('task-dag-context-toggle-upstream')).toBeDisabled();
    expect(screen.getByTestId('task-dag-context-toggle-downstream')).toBeDisabled();
  });
});
