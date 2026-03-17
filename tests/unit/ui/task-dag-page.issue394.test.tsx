import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/tasks/dag', searchStr: '' }),
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
    onNodeClick,
    onNodeContextMenu,
    nodeTypes,
    onInit,
    ...props
  }: {
    nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    edges?: Array<{ id: string }>;
    children?: ReactNode;
    onNodeClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
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

describe('TaskDagPage issue-394（任务 DAG 只读视图）', () => {
  beforeEach(() => {
    flowApiMocks.setCenter.mockReset();
    flowApiMocks.fitView.mockReset();
    flowApiMocks.getViewport.mockClear();
    flowApiMocks.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.12 });
    flowApiMocks.getNode.mockReset();
    flowApiMocks.lastProps = null;
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
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [{ taskId: 'task-a', type: 'soft' }],
      }),
    ]);
  });

  it('renders nodes, legends, current root summary and jump action', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-dag-page')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-current-root-summary')).toHaveTextContent('梳理 DAG 基础层');
    expect(screen.getByTestId('task-dag-current-root-badge-task-a')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-legend-hard')).toHaveTextContent('硬依赖');
    expect(screen.getByTestId('task-dag-legend-soft')).toHaveTextContent('软依赖');

    fireEvent.click(screen.getByTestId('task-dag-current-root-jump'));
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

  it('uses unblocked unfinished node as current root when structural roots are terminal', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({
        id: 'done-root',
        title: '已完成根节点',
        status: 'completed',
        createdAt: 10,
        updatedAt: 10,
      }),
      makeTask({
        id: 'downstream-open',
        title: '下游可执行节点',
        createdAt: 20,
        updatedAt: 20,
        dependsOn: [{ taskId: 'done-root', type: 'hard' }],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-dag-current-root-summary')).toHaveTextContent('下游可执行节点');
    expect(screen.getByTestId('task-dag-current-root-summary')).toHaveTextContent('未阻塞节点 1 个');
    expect(screen.queryByText('暂无未阻塞节点')).not.toBeInTheDocument();
  });

  it('updates the side panel when selecting another node', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-selected-panel')).toHaveTextContent('接入任务列表引导');
    });
    expect(screen.getByTestId('task-dag-selected-link')).toBeInTheDocument();
  });

  it('supports collapse downstream from the selected inspect panel', async () => {
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
        id: 'task-c',
        title: 'C',
        createdAt: 30,
        updatedAt: 30,
        dependsOn: [{ taskId: 'task-b', type: 'hard' }],
      }),
    ]);

    render(<TaskDagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-task-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-task-b'));
    fireEvent.click(screen.getByTestId('task-dag-selected-toggle-downstream'));

    await waitFor(() => {
      expect(screen.queryByTestId('mock-react-flow-node-task-c')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('task-dag-selected-toggle-downstream')).toHaveTextContent('展开下游');
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
