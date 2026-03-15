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
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
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
    nodeTypes,
    onInit,
  }: {
    nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    edges?: Array<{ id: string }>;
    children?: ReactNode;
    onNodeClick?: (_event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, (props: { id: string; data: Record<string, unknown> }) => JSX.Element>;
    onInit?: (instance: { setCenter: typeof flowApiMocks.setCenter; fitView: typeof flowApiMocks.fitView }) => void;
  }) => {
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
    expect(flowApiMocks.setCenter).toHaveBeenCalled();
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

    expect(await screen.findByTestId('task-dag-selected-panel')).toHaveTextContent('接入任务列表引导');
    expect(screen.getByTestId('task-dag-selected-link')).toBeInTheDocument();
  });
});
