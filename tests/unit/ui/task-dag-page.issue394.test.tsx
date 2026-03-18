import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDagPage } from '@/ui/app/pages/TaskDagPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const onTaskChangeMock = vi.fn(() => () => {});

const flowApiMocks = vi.hoisted(() => ({
  setCenter: vi.fn(),
  fitView: vi.fn(),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 0.12 })),
  getNode: vi.fn(),
  lastProps: null as null | Record<string, unknown>,
}));

const navigateMock = vi.hoisted(() => vi.fn());
const isDesktopMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/tasks/dag', searchStr: '' }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    onTaskChange: onTaskChangeMock,
  }),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onPaneClick,
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
    onPaneClick?: () => void;
    onNodeClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeDoubleClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeContextMenu?: (_event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string; data?: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, (props: { id: string; data: Record<string, unknown> }) => JSX.Element>;
    onInit?: (instance: {
      setCenter: typeof flowApiMocks.setCenter;
      fitView: typeof flowApiMocks.fitView;
      getViewport: typeof flowApiMocks.getViewport;
      getNode: typeof flowApiMocks.getNode;
    }) => void;
    [key: string]: unknown;
  }) => {
    flowApiMocks.lastProps = props;
    onInit?.(flowApiMocks);
    return (
      <div data-testid="mock-react-flow">
        <button type="button" data-testid="mock-react-flow-pane" onClick={() => onPaneClick?.()}>
          pane
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
              {NodeComponent ? <NodeComponent id={node.id} data={node.data ?? {}} /> : node.id}
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
  Position: { Left: 'left', Right: 'right' },
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

describe('TaskDagPage issue-394（任务 DAG Wave 1 / Wave 2）', () => {
  beforeEach(() => {
    flowApiMocks.setCenter.mockReset();
    flowApiMocks.fitView.mockReset();
    flowApiMocks.getViewport.mockClear();
    flowApiMocks.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.12 });
    flowApiMocks.getNode.mockReset();
    flowApiMocks.lastProps = null;
    navigateMock.mockReset();
    isDesktopMock.mockReset();
    isDesktopMock.mockReturnValue(true);
    listTasksMock.mockReset();
    onTaskChangeMock.mockClear();

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

  it('renders full-canvas workspace with floating controls and placeholder mode selector', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-dag-page')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-canvas-shell')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-mode-browse')).toBeEnabled();
    expect(screen.getByTestId('task-dag-mode-connect')).toBeDisabled();
    expect(screen.getByTestId('task-dag-mode-execute')).toBeDisabled();
    expect(screen.getByTestId('task-dag-legend-hard-chip')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-soft-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-current-root-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-selected-panel')).not.toBeInTheDocument();

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
    expect(screen.getByTestId('mock-react-flow-node-task-a')).toBeInTheDocument();
    expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
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
