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

const runtimeClientMocks = vi.hoisted(() => ({
  getAgents: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  streamAgentConversation: vi.fn(),
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
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/services/runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtime-client')>();

  class RuntimeClientMock {
    getAgents = runtimeClientMocks.getAgents;

    createAgent = runtimeClientMocks.createAgent;

    deleteAgent = runtimeClientMocks.deleteAgent;

    streamAgentConversation = runtimeClientMocks.streamAgentConversation;
  }

  return {
    ...actual,
    RuntimeClient: RuntimeClientMock,
  };
});

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

    runtimeClientMocks.getAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'echo',
          name: 'Echo Agent',
          description: '回显输入内容',
          status: 'available',
        },
      ],
    });
    runtimeClientMocks.createAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'runtime-created-agent',
        name: 'Runtime Created Agent',
        description: 'created in test',
        status: 'available',
      },
    });
    runtimeClientMocks.deleteAgent.mockResolvedValue({
      ok: true,
      data: {
        status: 'deleted',
        id: 'runtime-created-agent',
      },
    });

    let currentRoutes = SAMPLE_SIGNAL_ROUTES.map((route) => ({ ...route }));
    signalRouteFetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/signal-routes') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => currentRoutes,
        } as Response;
      }

      const match = url.match(/\/signal-routes\/([^/]+)$/);
      if (match && method === 'PUT') {
        const routeId = decodeURIComponent(match[1] ?? '');
        const updates = init?.body ? JSON.parse(String(init.body)) as { enabled?: boolean } : {};
        currentRoutes = currentRoutes.map((route) => (
          route.id === routeId ? { ...route, ...updates } : route
        ));
        const updated = currentRoutes.find((route) => route.id === routeId);
        return {
          ok: true,
          status: 200,
          json: async () => updated,
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', signalRouteFetchMock);
  });

  it.each([
    ['claude', 'Claude CLI'],
    ['codex', 'Codex'],
    ['echo', 'Echo'],
  ] as const)('creates runtime agent with %s kind（按 provider 类型创建 Runtime Agent）', async (kind, label) => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`agent-add-node-option-${kind}`));

    await waitFor(() => {
      expect(runtimeClientMocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.1',
          port: 1919,
        }),
        expect.objectContaining({
          kind,
        }),
      );
    });

    expect(screen.queryByTestId('agent-add-node-sheet')).not.toBeInTheDocument();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it('shows aggregated runtime agents with source host badge（聚合显示并标注来源主机）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '节点' }));

    await waitFor(() => {
      expect(screen.getByText('Echo Agent')).toBeInTheDocument();
      expect(screen.getAllByText(/来源 127\.0\.0\.1:1919/).length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(await screen.findByRole('button', { name: '路由' }));

    await waitFor(() => {
      expect(screen.getByText('信号路由')).toBeInTheDocument();
      expect(screen.getAllByText(/user\.input\.text|session\.end|timeblock\.completed/).length).toBeGreaterThanOrEqual(3);
    });

    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(SAMPLE_SIGNAL_ROUTES.length);
    expect(switches[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles route switch with immediate UI feedback（点击路由开关后应立即切换且发起更新）', async () => {
    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '路由' }));

    const firstSwitch = await screen.findAllByRole('switch').then((items) => items[0]!);
    expect(firstSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(firstSwitch);

    await waitFor(() => {
      expect(firstSwitch).toHaveAttribute('aria-checked', 'false');
    });

    expect(signalRouteFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/signal-routes/route-001'),
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });

  it('toggles routes loaded from auto-discovered host（从 auto 发现主机加载的路由也应可切换）', async () => {
    runtimeManagerMocks.refreshSnapshot.mockResolvedValueOnce({
      updatedAt: '2026-02-28T10:00:00.000Z',
      agents: [],
      hosts: [],
    });

    let currentRoutes = SAMPLE_SIGNAL_ROUTES.map((route) => ({ ...route }));
    signalRouteFetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === 'http://127.0.0.1:1949/signal-routes' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => currentRoutes,
        } as Response;
      }

      if (url === 'http://127.0.0.1:1949/agents' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }

      if (url === 'http://127.0.0.1:1949/signals/history?limit=120' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }

      if (url === 'http://127.0.0.1:1949/signal-routes/route-001' && method === 'PUT') {
        const updates = init?.body ? JSON.parse(String(init.body)) as { enabled?: boolean } : {};
        currentRoutes = currentRoutes.map((route) => (
          route.id === 'route-001' ? { ...route, ...updates } : route
        ));
        return {
          ok: true,
          status: 200,
          json: async () => currentRoutes.find((route) => route.id === 'route-001'),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '路由' }));

    const firstSwitch = await screen.findAllByRole('switch').then((items) => items[0]!);
    fireEvent.click(firstSwitch);

    await waitFor(() => {
      expect(firstSwitch).toHaveAttribute('aria-checked', 'false');
    });

    expect(signalRouteFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/signal-routes/route-001',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('opens add-device flow from header button（右上角按钮触发添加设备流程）', async () => {
    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('agent-add-node-button'));
    expect(await screen.findByTestId('agent-add-node-sheet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));
    expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
  });

  it('supports retry and remove actions for host cards（支持主机重试与删除）', async () => {
    runtimeManagerMocks.retryHost.mockResolvedValue(undefined);
    runtimeManagerMocks.removeHost.mockResolvedValue(undefined);
    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-add-node-button'));
    expect(await screen.findByTestId('agent-add-node-sheet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));

    fireEvent.click(await screen.findByTestId('runtime-host-probe-host-b'));
    fireEvent.click(screen.getByTestId('runtime-host-remove-host-b'));

    await waitFor(() => {
      expect(runtimeManagerMocks.retryHost).toHaveBeenCalledWith('host-b');
      expect(runtimeManagerMocks.removeHost).toHaveBeenCalledWith('host-b');
    });
  });
});
