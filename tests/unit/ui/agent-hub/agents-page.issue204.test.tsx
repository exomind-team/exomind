import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import type { SignalRoute } from '@/lib/types/signal-pool';

const serviceMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
  retryHost: vi.fn(),
  addHost: vi.fn(),
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
  {
    id: 'route-006',
    enabled: true,
    topic: '*',
    target_type: 'frontend',
    target_ref: 'ui',
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
  },
];

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getAgentHubService: () => ({
      getTopology: serviceMocks.getTopology,
      getDeviceView: serviceMocks.getDeviceView,
    }),
  };
});

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('agents page issue-204（主页面三视图与添加节点）', () => {
  beforeEach(() => {
    serviceMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    serviceMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1949,
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
          agents: [],
          topology: null,
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

  it('switches topology/list/device views（支持拓扑/列表/设备切换）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
    expect(screen.getByTestId('agent-hub-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    expect(screen.getByTestId('agent-topology-canvas')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('user.input.text')).toBeInTheDocument();
      expect(screen.getByText('session.end')).toBeInTheDocument();
      expect(screen.getByText('user.input.text → classifier')).toBeInTheDocument();
      expect(screen.getByText('session.end → reviewer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '节点' }));
    expect(screen.getByText('全部')).toBeInTheDocument();
    expect(screen.getByText('Echo Agent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设备' }));
    expect(screen.getByTestId('agent-device-view')).toBeInTheDocument();
    expect(screen.getByTestId('agent-device-overview-card')).toBeInTheDocument();
  });

  it('supports opening add node sheet from topology（支持从拓扑页打开添加节点弹窗）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));
    expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
    expect(screen.getByText('添加设备')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-host-manager-close'));
    expect(screen.queryByTestId('agent-host-manager-sheet')).not.toBeInTheDocument();
  });

  it('keeps dark-mode classes on key surfaces（关键区域包含暗色样式类）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-canvas')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-hub-page').className).toContain('dark:bg-[#0C0A09]');
    expect(screen.getByTestId('agent-topology-canvas').className).toContain('dark:bg-[#1C1917]');
  });

  it('uses signal-network page title with task-page sizing（标题改为信号网络且字号与任务页一致）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '信号网络' })).toBeInTheDocument();
    });

    const heading = screen.getByRole('heading', { name: '信号网络' });
    expect(heading.className).toContain('text-lg');
    expect(heading.className).toContain('font-semibold');
    expect(heading.className).not.toContain('text-[30px]');
  });
});
