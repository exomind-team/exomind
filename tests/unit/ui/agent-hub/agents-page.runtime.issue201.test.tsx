import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalRoute } from '@/lib/types/signal-pool';

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
  retryHost: vi.fn(),
  addHostFromAddress: vi.fn(),
  removeHost: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onNodeClick,
  }: {
    nodes?: Array<{ id: string; data?: { label?: string } }>;
    edges?: Array<{ id: string; label?: string; source?: string; target?: string }>;
    children?: unknown;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="mock-react-flow">
      {(nodes ?? []).map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`mock-react-flow-node-${node.id}`}
          onClick={() => onNodeClick?.({}, node)}
        >
          {node.data?.label ?? node.id}
        </button>
      ))}
      {(edges ?? []).map((edge) => (
        <div key={edge.id} data-testid={`mock-react-flow-edge-${edge.id}`}>
          {edge.label ?? `${edge.source} -> ${edge.target}`}
        </div>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  MiniMap: () => <div data-testid="mock-react-flow-minimap" />,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()] as const,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

const signalRouteFetchMock = vi.hoisted(() => vi.fn());

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-002',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-003',
    enabled: true,
    topic: 'session.end',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-004',
    enabled: true,
    topic: 'timeblock.completed',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
  {
    id: 'route-005',
    enabled: false,
    topic: 'input.classified',
    target_type: 'actor',
    target_ref: 'task',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
];

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('agents page runtime issue-201（AgentsPage 真实数据聚合）', () => {
  beforeEach(() => {
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1919,
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-02-28T10:00:00.000Z',
      agents: [
        {
          id: 'echo',
          name: 'Echo Agent',
          description: '回显输入内容',
          status: 'available',
          sourceHostId: 'host-a',
          sourceHostName: '127.0.0.1:1919',
          sourceHostAddress: '127.0.0.1:1919',
        },
      ],
      hosts: [
        {
          host: {
            id: 'host-a',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            status: 'unknown',
            createdAt: '2026-02-28T00:00:00.000Z',
            updatedAt: '2026-02-28T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [
            {
              id: 'echo',
              name: 'Echo Agent',
              description: '回显输入内容',
              status: 'available',
              sourceHostId: 'host-a',
              sourceHostName: '127.0.0.1:1919',
              sourceHostAddress: '127.0.0.1:1919',
            },
          ],
          topology: null,
        },
        {
          host: {
            id: 'host-b',
            name: '192.168.1.22:2919',
            host: '192.168.1.22',
            port: 2919,
            status: 'unknown',
            createdAt: '2026-02-28T00:00:00.000Z',
            updatedAt: '2026-02-28T00:00:00.000Z',
          },
          connectionState: 'offline',
          agents: [],
          topology: null,
          error: 'ECONNREFUSED',
        },
      ],
    });

    signalRouteFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SAMPLE_SIGNAL_ROUTES,
    } as Response);
    vi.stubGlobal('fetch', signalRouteFetchMock);
  });

  it('shows aggregated runtime agents with source host badge（聚合显示并标注来源主机）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-list'));

    await waitFor(() => {
      expect(screen.getByText('Echo Agent')).toBeInTheDocument();
      expect(screen.getAllByText(/来源 127\.0\.0\.1:1919/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId('agent-signal-route-section')).toBeInTheDocument();
      expect(screen.getAllByTestId(/agent-signal-route-row-/).length).toBeGreaterThanOrEqual(5);
    });
  });

  it('opens add-device flow from header button（右上角按钮触发添加设备流程）', async () => {
    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('agent-add-node-button'));
    expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));
    expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
  });

  it('supports retry and remove actions for host cards（支持主机重试与删除）', async () => {
    runtimeManagerMocks.retryHost.mockResolvedValue(undefined);
    runtimeManagerMocks.removeHost.mockResolvedValue(undefined);
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-add-node-button'));
    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));

    fireEvent.click(await screen.findByTestId('runtime-host-probe-host-b'));
    fireEvent.click(screen.getByTestId('runtime-host-remove-host-b'));

    await waitFor(() => {
      expect(runtimeManagerMocks.retryHost).toHaveBeenCalledWith('host-b');
      expect(runtimeManagerMocks.removeHost).toHaveBeenCalledWith('host-b');
    });
  });
});
