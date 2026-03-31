import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDagPage, getNextTaskDagMode } from '@/ui/app/pages/TaskDagPage';
import type { TaskNode } from '@/lib/types/task';

const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn());

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
const appendEventDataMock = vi.fn();

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
const locationState = vi.hoisted(() => ({ pathname: '/tasks/dag', searchStr: '' }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useLocation: () => locationState,
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
  getEventLogService: () => ({
    appendEventData: appendEventDataMock,
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
  Background: ({ variant }: { variant?: string }) => (
    <div data-testid="mock-react-flow-background" data-variant={variant ?? 'default'} />
  ),
  BackgroundVariant: { Dots: 'dots', Lines: 'lines' },
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => isDesktopMock(),
}));

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

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
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(async () => {
    locationState.pathname = '/tasks/dag';
    locationState.searchStr = '';
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
    appendEventDataMock.mockReset();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockResolvedValue(false);
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });
    originalFetch = globalThis.fetch;

    loadActiveBlockMock.mockResolvedValue(null);
    markEndingMock.mockResolvedValue(undefined);
    endBlockMock.mockResolvedValue(null);
    startBlockForTaskMock.mockResolvedValue(null);
    calculateSpentMinutesMock.mockResolvedValue(0);
    addTaskToBlockMock.mockResolvedValue(undefined);
    removeTaskFromBlockMock.mockResolvedValue(undefined);
    onBlockEndForTasksMock.mockResolvedValue(undefined);
    appendEventDataMock.mockResolvedValue(undefined);
    transitionTaskMock.mockResolvedValue(null);
    createTaskMock.mockResolvedValue(null);
    addDependencyMock.mockResolvedValue(null);
    removeDependencyMock.mockResolvedValue(null);
    window.localStorage.clear();
    window.sessionStorage.clear();

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();

    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '梳理 DAG 基础层', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '接入任务列表引导',
        description: '## 说明\n\n需要在浏览模式展示 **Markdown** 描述。',
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

  afterEach(async () => {
    vi.useRealTimers();
    if (originalFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
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
    expect(screen.getByText('任务依赖图')).toBeInTheDocument();
    expect(screen.getByText('依赖图')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-hard-chip')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-soft-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-current-root-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-current-root-badge-task-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-selected-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-a').className).toContain('border-[#16A34A]/60');
    expect(screen.getByTestId('task-dag-jump-to-root')).toHaveTextContent('聚焦可执行');

    fireEvent.click(screen.getByTestId('task-dag-jump-to-root'));
    expect(flowApiMocks.fitView).toHaveBeenCalledWith({
      nodes: [{ id: 'task-a' }],
      duration: 300,
      padding: 0.3,
    });
  });

  it('keeps fit-view zoom options available without auto-fitting on first load', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(flowApiMocks.lastProps).toMatchObject({
      minZoom: 0.01,
      fitViewOptions: {
        padding: 0.2,
        minZoom: 0.01,
      },
    });
    expect(flowApiMocks.fitView).not.toHaveBeenCalled();
  });

  it('keeps ReactFlow auto-fit disabled so execute-mode state changes do not re-fit the viewport', async () => {
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
    expect(flowApiMocks.lastProps).not.toHaveProperty('fitView');

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-a', { mode: 'countdown', minutes: 25 });
    });
  });

  it('keeps node positions stable when execute-mode state changes only affect node appearance', async () => {
    calculateSpentMinutesMock.mockResolvedValue(15);
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '可执行任务', estimatedMinutes: 40, createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '后继任务',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    const beforeExecute = (flowApiMocks.lastProps as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }).nodes.map((node) => ({ id: node.id, position: node.position }));

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-a', { mode: 'countdown', minutes: 25 });
    });

    const afterExecute = (flowApiMocks.lastProps as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }).nodes.map((node) => ({ id: node.id, position: node.position }));

    expect(afterExecute).toEqual(beforeExecute);
  });

  it('recomputes layout when hide-terminal removes visible nodes after execute updates', async () => {
    let taskChangeCallback: (() => void) | null = null;
    let currentTasks: TaskNode[] = [
      makeTask({ id: 'task-root', title: '测试根', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
      makeTask({ id: 'task-side', title: '旁支任务', createdAt: 40, updatedAt: 40 }),
    ];

    window.localStorage.setItem('exomind:dag-hide-terminal', '1');
    onTaskChangeMock.mockImplementation((callback) => {
      taskChangeCallback = callback;
      return () => {};
    });
    listTasksMock.mockImplementation(async () => currentTasks);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-side')).toBeInTheDocument();
    });

    const beforeFilteredUpdate = (flowApiMocks.lastProps as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }).nodes.reduce<Record<string, { x: number; y: number }>>((positions, node) => {
      positions[node.id] = node.position;
      return positions;
    }, {});

    currentTasks = [
      makeTask({ id: 'task-root', title: '测试根', status: 'completed', createdAt: 10, updatedAt: 50 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        status: 'in_progress',
        createdAt: 20,
        updatedAt: 51,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        status: 'completed',
        createdAt: 30,
        updatedAt: 52,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
      makeTask({ id: 'task-side', title: '旁支任务', createdAt: 40, updatedAt: 53 }),
    ];

    await act(async () => {
      taskChangeCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-root')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-side')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-react-flow-node-task-grandchild')).not.toBeInTheDocument();
    });

    const afterFilteredUpdate = (flowApiMocks.lastProps as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }).nodes.reduce<Record<string, { x: number; y: number }>>((positions, node) => {
      positions[node.id] = node.position;
      return positions;
    }, {});

    expect(Object.keys(afterFilteredUpdate)).not.toContain('task-grandchild');
    expect(Object.keys(afterFilteredUpdate).length).toBeLessThan(Object.keys(beforeFilteredUpdate).length);
  });

  it('does not auto-fit after nodes finish loading when no saved viewport exists', async () => {
    let resolveTasks: ((tasks: TaskNode[]) => void) | null = null;
    listTasksMock.mockImplementationOnce(() => new Promise<TaskNode[]>((resolve) => {
      resolveTasks = resolve;
    }));

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });
    expect(flowApiMocks.fitView).not.toHaveBeenCalled();

    resolveTasks?.([
      makeTask({ id: 'task-a', title: '异步返回节点', createdAt: 10, updatedAt: 10 }),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });
    expect(flowApiMocks.fitView).not.toHaveBeenCalled();
    expect(flowApiMocks.setViewport).not.toHaveBeenCalled();
  });

  it('restores the saved dag viewport instead of refitting when revisiting the page', async () => {
    window.localStorage.setItem('exomind:dag-viewport', JSON.stringify({
      surface: 'desktop',
      direction: 'auto',
      x: -320,
      y: -180,
      zoom: 0.42,
    }));

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(flowApiMocks.setViewport).toHaveBeenCalledWith({
        x: -320,
        y: -180,
        zoom: 0.42,
      });
    });
    expect(flowApiMocks.fitView).not.toHaveBeenCalled();
  });

  it('reacts to late storage-backed mode updates after mount（挂载后会响应晚到的 DAG 模式同步）', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBeNull();

    await act(async () => {
      window.localStorage.setItem('exomind:dag-mode', 'execute');
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'exomind:dag-mode',
        newValue: 'execute',
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-mode-execute').className).toContain('font-semibold');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-a', { mode: 'countup' });
    });
  });

  it('keeps late runtime dag mode instead of overwriting it on first mount（晚到 Runtime 模式不应被首帧旧值覆盖）', async () => {
    window.localStorage.setItem('exomind:dag-mode', 'browse');

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });
    expect(screen.getByTestId('task-dag-mode-browse').className).toContain('font-semibold');

    await act(async () => {
      window.localStorage.setItem('exomind:dag-mode', 'execute');
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'exomind:dag-mode',
        newValue: 'execute',
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-mode-execute').className).toContain('font-semibold');
      expect(window.localStorage.getItem('exomind:dag-mode')).toBe('execute');
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
    expect(lastProps.edges[0]).toMatchObject({ type: 'dagreRouted' });
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
    // Default mobile auto layout should not backfill storage on first mount（首帧不应回写默认方向）
    expect(window.localStorage.getItem('exomind:dag-direction')).toBeNull();
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

  it('clears the selected node with Escape when no higher-priority mode state is active', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-detail-panel-desktop')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-detail-panel-desktop')).not.toBeInTheDocument();
    });
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
    expect(within(detailPanel).getByText('任务描述')).toBeInTheDocument();
    expect(within(detailPanel).getByText((content) => content.includes('需要在浏览模式展示'))).toBeInTheDocument();
    expect(detailPanel.className).toContain('bottom-24');
  });

  it('keeps selected node highlight visible in connect mode', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-node-task-a').className).toContain('ring-[#2563EB]/30');
    });
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
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('smart');
    expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
  });

  it('keeps terminal nodes visible when they still carry active downstream work', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '已完成上游', status: 'completed', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '仍在推进',
        status: 'pending',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-hide-terminal-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });
  });

  it('hides terminal-only chains when hide terminal is enabled', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '已完成上游', status: 'completed', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '已完成下游',
        status: 'completed',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
      makeTask({ id: 'task-c', title: '旁支待办', createdAt: 30, updatedAt: 30 }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-c')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-hide-terminal-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-a')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mock-react-flow-node-task-b')).not.toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-c')).toBeInTheDocument();
    });
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

  it('supports description, fuzzy, and filter search options with localStorage persistence', async () => {
    const view = render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('task-dag-search-input'), { target: { value: 'mrkdwn' } });
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-match-count')).toHaveTextContent('0');
    });

    fireEvent.click(screen.getByTestId('task-dag-search-option-description'));
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-match-count')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('task-dag-search-option-fuzzy'));
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-match-count')).toHaveTextContent('0');
    });

    fireEvent.change(screen.getByTestId('task-dag-search-input'), { target: { value: 'Markdown' } });
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-match-count')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('task-dag-search-option-filter'));
    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-a')).not.toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    expect(JSON.parse(window.localStorage.getItem('exomind:dag-search-options') ?? '{}')).toMatchObject({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    });
    expect(window.localStorage.getItem('exomind:dag-search-draft')).toBe('Markdown');

    view.unmount();
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-search-input')).toHaveValue('Markdown');
      expect(screen.getByTestId('task-dag-search-option-description')).toBeInTheDocument();
      expect(screen.getByTestId('task-dag-search-option-filter')).toBeInTheDocument();
    });
  });

  it('cycles terminal filtering through smart, strict, and show modes', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-c')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('task-dag-hide-terminal-toggle');
    expect(toggle).toHaveTextContent('显示全部');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-c')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('smart');

    fireEvent.click(toggle);
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('hide');

    fireEvent.click(toggle);
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('show');
  });

  it('switches background mode and persists the variant', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-background')).toHaveAttribute('data-variant', 'dots');
    });

    fireEvent.click(screen.getByTestId('task-dag-background-lines'));
    expect(screen.getByTestId('mock-react-flow-background')).toHaveAttribute('data-variant', 'lines');
    expect(window.localStorage.getItem('exomind:dag-background-mode')).toBe('lines');

    fireEvent.click(screen.getByTestId('task-dag-background-none'));
    expect(screen.queryByTestId('mock-react-flow-background')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('exomind:dag-background-mode')).toBe('none');
  });

  it('clears execute selection on pane click', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      const node = (flowApiMocks.lastProps as {
        nodes: Array<{ id: string; data: { isSelected?: boolean } }>;
      }).nodes.find((entry) => entry.id === 'task-a');
      expect(node?.data.isSelected).toBe(true);
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-pane'));

    await waitFor(() => {
      const node = (flowApiMocks.lastProps as {
        nodes: Array<{ id: string; data: { isSelected?: boolean } }>;
      }).nodes.find((entry) => entry.id === 'task-a');
      expect(node?.data.isSelected).toBe(false);
    });
  });

  it('uses the same mode cycle order for Ctrl+Alt+wheel and related shortcuts', () => {
    expect(getNextTaskDagMode('browse', 1)).toBe('connect');
    expect(getNextTaskDagMode('connect', 1)).toBe('execute');
    expect(getNextTaskDagMode('execute', 1)).toBe('browse');
    expect(getNextTaskDagMode('browse', -1)).toBe('execute');
    expect(getNextTaskDagMode('execute', -1)).toBe('connect');
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

  it('cycles enabled dag modes when the mode selector is wheeled', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    const selector = screen.getByTestId('task-dag-mode-selector');

    fireEvent.wheel(selector, { deltaY: 120 });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('connect');

    fireEvent.wheel(selector, { deltaY: 120 });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('execute');

    fireEvent.wheel(selector, { deltaY: -120 });
    expect(window.localStorage.getItem('exomind:dag-mode')).toBe('connect');
  });

  it('switches to browse and reveals the target when opened with locate search params', async () => {
    locationState.searchStr = '?focus=%22task-b%22&locate=%221%22';
    window.localStorage.setItem('exomind:dag-mode', 'execute');
    window.localStorage.setItem('exomind:dag-hide-terminal', 'hide');
    window.localStorage.setItem('exomind:dag-search-draft', '别的任务');

    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '进行中的主线', status: 'pending', createdAt: 10, updatedAt: 10 }),
      makeTask({ id: 'task-b', title: '2026-03-22 洗澡', status: 'completed', createdAt: 20, updatedAt: 20 }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:dag-mode')).toBe('browse');
    });
    expect(window.localStorage.getItem('exomind:dag-hide-terminal')).toBe('show');
    await waitFor(() => {
      const nodes = (flowApiMocks.lastProps as {
        nodes: Array<{ id: string; data?: { isSelected?: boolean } }>;
      }).nodes;
      const targetNode = nodes.find((node) => node.id === 'task-b');
      expect(targetNode?.data?.isSelected).toBe(true);
    });
    await waitFor(() => {
      expect(flowApiMocks.setCenter).toHaveBeenCalled();
    });
  });

  it('supports keyboard mode switching, escape cleanup, and pan shortcuts from the centralized dag hook', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
    // Ctrl-only arrows should not mutate mode persistence（仅 Ctrl 不应把默认 browse 回写进存储）
    expect(window.localStorage.getItem('exomind:dag-mode')).toBeNull();

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:dag-mode')).toBe('connect');
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(screen.getByText('准备硬依赖')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('准备硬依赖')).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(window.localStorage.getItem('exomind:dag-mode')).toBe('execute');
    });

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(flowApiMocks.setViewport).toHaveBeenCalledWith({
      x: 8,
      y: 0,
      zoom: 0.12,
    });
  });

  it('renders dynamic key hints and hides them in immersive mode', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-key-hints')).toBeInTheDocument();
    });

    expect(screen.getByTestId('task-dag-key-hints').className).toContain('max-w-[50%]');
    expect(screen.getByText('Ctrl+Alt+←/→')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl+←/→')).not.toBeInTheDocument();
    expect(screen.getByText('切换模式')).toBeInTheDocument();
    expect(screen.getAllByText('长按平移')).toHaveLength(2);
    expect(screen.getByText('长按缩放')).toBeInTheDocument();
    expect(screen.getByText('聚焦屏幕中心最近节点')).toBeInTheDocument();
    expect(screen.getByText('空白单击 取消选中')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    await waitFor(() => {
      expect(screen.getByText('导航节点')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    expect(screen.getByText('设为连接起点')).toBeInTheDocument();
    expect(screen.getByText('双击空白处 快速创建任务')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    await waitFor(() => {
      expect(screen.getByText('取消连接')).toBeInTheDocument();
    });
    expect(screen.getByText('快速新增下游')).toBeInTheDocument();
    expect(screen.getByText('空白单击 新建下游')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-immersive-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-key-hints')).not.toBeInTheDocument();
    });
  });

  it('collapses control panels into mobile toggles on narrow screens', async () => {
    isDesktopMock.mockReturnValue(false);
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('task-dag-search-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-tools-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-key-hints')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-mobile-search-toggle'));
    expect(screen.getByTestId('task-dag-search-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-mobile-tools-toggle'));
    expect(screen.getByTestId('task-dag-tools-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-key-hints-toggle'));
    expect(screen.getByTestId('task-dag-key-hints')).toBeInTheDocument();
  });

  it('keeps mobile immersive search and tools panels visible after opening them', async () => {
    isDesktopMock.mockReturnValue(false);
    window.localStorage.setItem('exomind:dag-immersive', '1');

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mobile-search-toggle'));
    expect(screen.getByTestId('task-dag-search-panel').className).not.toContain('opacity-0');

    fireEvent.click(screen.getByTestId('task-dag-mobile-tools-toggle'));
    expect(screen.getByTestId('task-dag-tools-panel').className).not.toContain('opacity-0');
    expect(screen.getByTestId('task-dag-legend-panel').className).not.toContain('opacity-0');
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

  it('hides the browse-mode control panel while the detail panel is open', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-hide-terminal-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-detail-panel-desktop')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('task-dag-hide-terminal-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-legend-hard-chip')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    expect(screen.getByTestId('task-dag-hide-terminal-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-hard-chip')).toBeInTheDocument();
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

  it('persists collapsed dag visibility state to localStorage and restores it on remount', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-a', title: '唯一上游', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-b',
        title: '折叠目标',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-a', type: 'hard' }],
      }),
    ]);

    const view = render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    fireEvent.keyDown(document, { key: 'F', altKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-a')).not.toBeInTheDocument();
    });

    expect(JSON.parse(window.localStorage.getItem('exomind:dag-visibility') ?? '{}')).toMatchObject({
      collapsedUpstreamOf: ['task-b'],
      collapsedDownstreamOf: [],
    });

    view.unmount();
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-a')).not.toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });
  });

  it('updates selected node mode-specific data immediately when switching modes', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));

    await waitFor(() => {
      const browseNode = (flowApiMocks.lastProps as {
        nodes: Array<{ id: string; data: { isSelected?: boolean; showConnectHandles?: boolean } }>;
      }).nodes.find((node) => node.id === 'task-a');
      expect(browseNode?.data.isSelected).toBe(true);
      expect(browseNode?.data.showConnectHandles).toBe(false);
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));

    await waitFor(() => {
      const connectNode = (flowApiMocks.lastProps as {
        nodes: Array<{ id: string; data: { isSelected?: boolean; showConnectHandles?: boolean } }>;
      }).nodes.find((node) => node.id === 'task-a');
      expect(connectNode?.data.isSelected).toBe(true);
      expect(connectNode?.data.showConnectHandles).toBe(true);
    });
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

  it('reuses the current connect state when keyboard quick-create adds a soft dependency', async () => {
    createTaskMock.mockResolvedValueOnce(makeTask({ id: 'task-soft-downstream', title: '键盘软依赖下游任务' }));

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-connect'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    expect(screen.getByText('准备软依赖')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(await screen.findByTestId('task-quick-create-dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('task-quick-create-title'), { target: { value: '键盘软依赖下游任务' } });
    fireEvent.click(screen.getByTestId('task-quick-create-submit'));

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-soft-downstream', 'task-a', 'soft');
    });
  });

  it('toggles downstream collapse with Alt+F from the current focused node', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-a'));
    fireEvent.keyDown(document, { key: 'F', altKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-b')).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'F', altKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
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

  it('ignores stale task reload results so execute-mode updates do not collapse the dag to one node', async () => {
    let taskChangeCallback: (() => void) | null = null;
    let resolveStaleReload: ((tasks: TaskNode[]) => void) | null = null;

    onTaskChangeMock.mockImplementation((callback) => {
      taskChangeCallback = callback;
      return () => {};
    });

    listTasksMock
      .mockResolvedValueOnce([
        makeTask({ id: 'task-root', title: '测试根', createdAt: 10, updatedAt: 10 }),
        makeTask({
          id: 'task-child',
          title: '下级任务',
          createdAt: 20,
          updatedAt: 20,
          dependsOn: [{ taskId: 'task-root', type: 'soft' }],
        }),
        makeTask({
          id: 'task-grandchild',
          title: '再下级任务',
          createdAt: 30,
          updatedAt: 30,
          dependsOn: [{ taskId: 'task-child', type: 'soft' }],
        }),
      ])
      .mockImplementationOnce(() => new Promise<TaskNode[]>((resolve) => {
        resolveStaleReload = resolve;
      }))
      .mockResolvedValueOnce([
        makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 40 }),
        makeTask({
          id: 'task-child',
          title: '下级任务',
          status: 'suspended',
          createdAt: 20,
          updatedAt: 41,
          dependsOn: [{ taskId: 'task-root', type: 'soft' }],
        }),
        makeTask({
          id: 'task-grandchild',
          title: '再下级任务',
          createdAt: 30,
          updatedAt: 42,
          dependsOn: [{ taskId: 'task-child', type: 'soft' }],
        }),
      ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-root')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-grandchild')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));

    await act(async () => {
      taskChangeCallback?.();
      taskChangeCallback?.();
    });

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledTimes(3);
    });

    resolveStaleReload?.([
      makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 39 }),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-root')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-grandchild')).toBeInTheDocument();
    });
  });

  it('keeps all execute-mode nodes visible and leaves the viewport untouched across suspend and restart cycles', async () => {
    let taskChangeCallback: (() => void) | null = null;
    let blockChangeCallback: ((block: {
      startId: string;
      name: string;
      mode: 'countup';
      elapsed: number;
      startTime: number;
      paused: boolean;
      phase: 'running';
      taskIds: string[];
      taskAssociationLog: [];
    } | null) => void) | null = null;

    let currentTasks: TaskNode[] = [
      makeTask({ id: 'task-root', title: '测试根', createdAt: 10, updatedAt: 10 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ];

    onTaskChangeMock.mockImplementation((callback) => {
      taskChangeCallback = callback;
      return () => {};
    });
    onBlockChangeMock.mockImplementation((callback) => {
      blockChangeCallback = callback;
      return () => {};
    });
    listTasksMock.mockImplementation(async () => currentTasks);

    const emitTaskAndBlock = async (
      nextTasks: TaskNode[],
      block: {
        startId: string;
        name: string;
        mode: 'countup';
        elapsed: number;
        startTime: number;
        paused: boolean;
        phase: 'running';
        taskIds: string[];
        taskAssociationLog: [];
      } | null,
    ) => {
      currentTasks = nextTasks;
      await act(async () => {
        blockChangeCallback?.(block);
        taskChangeCallback?.();
      });
      await waitFor(() => {
        expect(screen.getByTestId('mock-react-flow-node-task-root')).toBeInTheDocument();
        expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
        expect(screen.getByTestId('mock-react-flow-node-task-grandchild')).toBeInTheDocument();
      });
    };

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-root')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-child')).toBeInTheDocument();
      expect(screen.getByTestId('mock-react-flow-node-task-grandchild')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-dag-mode-execute'));

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-root'));
    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-root', { mode: 'countup' });
    });

    await emitTaskAndBlock([
      makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 40 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        createdAt: 20,
        updatedAt: 41,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 42,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ], {
      startId: 'block-1',
      name: '执行时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-root'],
      taskAssociationLog: [],
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-child'));
    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-child');
    });

    await emitTaskAndBlock([
      makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 50 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        status: 'in_progress',
        createdAt: 20,
        updatedAt: 51,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 52,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ], {
      startId: 'block-1',
      name: '执行时间块',
      mode: 'countup',
      elapsed: 3,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-root', 'task-child'],
      taskAssociationLog: [],
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-child'));
    expect(await screen.findByTestId('task-dag-disassociate-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-dag-disassociate-submit'));

    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-child');
    });
    expect(transitionTaskMock).toHaveBeenCalledWith('task-child', 'suspended');

    await emitTaskAndBlock([
      makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 60 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        status: 'suspended',
        createdAt: 20,
        updatedAt: 61,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 62,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ], {
      startId: 'block-1',
      name: '执行时间块',
      mode: 'countup',
      elapsed: 8,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-root'],
      taskAssociationLog: [],
    });

    await emitTaskAndBlock([
      makeTask({ id: 'task-root', title: '测试根', status: 'suspended', createdAt: 10, updatedAt: 70 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        status: 'suspended',
        createdAt: 20,
        updatedAt: 71,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 72,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ], null);

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-root'));
    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledTimes(2);
    });

    await emitTaskAndBlock([
      makeTask({ id: 'task-root', title: '测试根', status: 'in_progress', createdAt: 10, updatedAt: 80 }),
      makeTask({
        id: 'task-child',
        title: '下级任务',
        status: 'suspended',
        createdAt: 20,
        updatedAt: 81,
        dependsOn: [{ taskId: 'task-root', type: 'soft' }],
      }),
      makeTask({
        id: 'task-grandchild',
        title: '再下级任务',
        createdAt: 30,
        updatedAt: 82,
        dependsOn: [{ taskId: 'task-child', type: 'soft' }],
      }),
    ], {
      startId: 'block-2',
      name: '重新开始的时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-root'],
      taskAssociationLog: [],
    });

    expect((flowApiMocks.lastProps as { nodes: Array<{ id: string }> }).nodes).toHaveLength(3);
    expect(flowApiMocks.fitView).not.toHaveBeenCalled();
    expect(flowApiMocks.setViewport).not.toHaveBeenCalled();
    expect(flowApiMocks.setCenter).not.toHaveBeenCalled();
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
    expect(screen.queryByTestId('task-dag-disassociate-status-continue')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-disassociate-status-completed'));
    fireEvent.click(screen.getByTestId('task-dag-disassociate-submit'));

    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-a');
    });
    expect(transitionTaskMock).toHaveBeenCalledWith('task-a', 'completed');
  });

  it('hides unavailable upstream/downstream actions in the context menu when a node cannot be safely folded', async () => {
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

    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-context-toggle-upstream')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-dag-context-toggle-downstream')).not.toBeInTheDocument();
    });
  });
});
