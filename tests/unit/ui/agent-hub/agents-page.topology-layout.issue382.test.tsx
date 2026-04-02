import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';
import type { SignalRoute } from '@/lib/types/signal-pool';
import { TOPOLOGY_LAYOUT_STORAGE_KEY } from '@/ui/app/pages/topology-layout';

const serviceMocks = vi.hoisted(() => ({
  getTopology: vi.fn(),
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
}));

const runtimeControlMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

const reactFlowRuntime = vi.hoisted(() => {
  let currentViewport = { x: 48, y: 64, zoom: 1.18 };
  return {
    fitView: vi.fn((_options?: unknown) => {
      currentViewport = { x: 0, y: 0, zoom: 1 };
      return Promise.resolve(true);
    }),
    setViewport: vi.fn((viewport: { x: number; y: number; zoom: number }) => {
      currentViewport = viewport;
      return Promise.resolve(true);
    }),
    getViewport: vi.fn(() => currentViewport),
    reset: () => {
      currentViewport = { x: 48, y: 64, zoom: 1.18 };
    },
  };
});

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
    onNodeClick,
    onNodeDragStop,
    onMoveEnd,
    defaultViewport,
    onInit,
  }: {
    nodes?: Array<{
      id: string;
      draggable?: boolean;
      position: { x: number; y: number };
      data?: { label?: string };
    }>;
    edges?: Array<{ id: string; label?: string; source?: string; target?: string }>;
    children?: unknown;
    onNodeClick?: (_event: unknown, node: { id: string }) => void;
    onNodeDragStop?: (_event: unknown, node: { id: string; position: { x: number; y: number } }) => void;
    onMoveEnd?: (_event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
    defaultViewport?: { x: number; y: number; zoom: number };
    onInit?: (instance: {
      fitView: (_options?: unknown) => Promise<boolean>;
      setViewport: (viewport: { x: number; y: number; zoom: number }, _options?: unknown) => Promise<boolean>;
      getViewport: () => { x: number; y: number; zoom: number };
    }) => void;
  }) => {
    onInit?.({
      fitView: reactFlowRuntime.fitView,
      setViewport: reactFlowRuntime.setViewport,
      getViewport: reactFlowRuntime.getViewport,
    });
    return (
      <div data-testid="mock-react-flow">
        <div data-testid="mock-react-flow-nodes-json">
          {JSON.stringify((nodes ?? []).map((node) => ({
            id: node.id,
            position: node.position,
            draggable: node.draggable !== false,
          })))}
        </div>
        <div data-testid="mock-react-flow-viewport-json">
          {JSON.stringify(defaultViewport ?? null)}
        </div>
        {(nodes ?? []).map((node) => (
          <div key={node.id}>
            <button
              type="button"
              data-testid={`mock-react-flow-node-${node.id}`}
              onClick={() => onNodeClick?.({}, node)}
            >
              {node.data?.label ?? node.id}
            </button>
            <button
              type="button"
              data-testid={`mock-react-flow-drag-${node.id}`}
              disabled={node.draggable === false}
              onClick={() => onNodeDragStop?.({}, {
                id: node.id,
                position: {
                  x: node.position.x + 111,
                  y: node.position.y + 77,
                },
              })}
            >
              drag
            </button>
          </div>
        ))}
        {(edges ?? []).map((edge) => (
          <div key={edge.id}>{edge.label ?? `${edge.source} -> ${edge.target}`}</div>
        ))}
        <button
          type="button"
          data-testid="mock-react-flow-move-end"
          onClick={() => onMoveEnd?.({}, { x: 21, y: 34, zoom: 0.91 })}
        >
          move-end
        </button>
        {children}
      </div>
    );
  },
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: () => <div data-testid="mock-react-flow-controls" />,
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
];

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getAgentHubService: () => ({
      getTopology: serviceMocks.getTopology,
      getDeviceView: serviceMocks.getDeviceView,
      getAgentDetail: serviceMocks.getAgentDetail,
    }),
  };
});

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn(() => null),
  shouldAutoPollRuntimeHost: vi.fn(() => true),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

function createRuntimeSnapshot(status: string = 'available') {
  return {
    updatedAt: '2026-02-28T10:00:00.000Z',
    agents: [
      {
        id: 'classifier',
        name: 'Classifier Agent',
        description: 'classifies input',
        status,
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
            id: 'classifier',
            name: 'Classifier Agent',
            description: 'classifies input',
            status,
            sourceHostId: 'host-a',
            sourceHostName: '127.0.0.1:1919',
            sourceHostAddress: '127.0.0.1:1919',
          },
        ],
        topology: null,
      },
    ],
  };
}

function readClassifierPosition() {
  const raw = screen.getByTestId('mock-react-flow-nodes-json').textContent ?? '[]';
  const nodes = JSON.parse(raw) as Array<{ id: string; position: { x: number; y: number } }>;
  return nodes.find((node) => node.id === 'agent:classifier')?.position ?? null;
}

function readViewport() {
  const raw = screen.getByTestId('mock-react-flow-viewport-json').textContent ?? 'null';
  return JSON.parse(raw) as { x: number; y: number; zoom: number } | null;
}

describe('agents page topology layout issue-382（拓扑布局持久化）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reactFlowRuntime.fitView.mockReset();
    reactFlowRuntime.setViewport.mockReset();
    reactFlowRuntime.getViewport.mockClear();
    reactFlowRuntime.reset();
    serviceMocks.getTopology.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.topology);
    serviceMocks.getDeviceView.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.deviceGroups);
    serviceMocks.getAgentDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.agentDetails['agent-daily']);
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1949,
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue(createRuntimeSnapshot());

    signalRouteFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SAMPLE_SIGNAL_ROUTES,
    } as Response);

    vi.stubGlobal('fetch', signalRouteFetchMock);
  });

  it('persists manual node position and viewport across reloads（拖拽后刷新仍恢复节点位置与视口）', async () => {
    const firstRender = render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));
    fireEvent.click(screen.getByTestId('mock-react-flow-move-end'));

    await waitFor(() => {
      const raw = window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY);
      expect(raw).toContain('agent:classifier');
      expect(raw).toContain('"zoom":0.91');
    });

    firstRender.unmount();
    reactFlowRuntime.setViewport.mockClear();
    render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 711, y: 157 });
      expect(readViewport()).toEqual({ x: 21, y: 34, zoom: 0.91 });
      expect(reactFlowRuntime.setViewport).toHaveBeenCalledWith(
        { x: 21, y: 34, zoom: 0.91 },
        { duration: 0 },
      );
    });
  });

  it('captures current viewport on first manual drag before any viewport save（首次拖拽也应一并保存当前视口）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));

    await waitFor(() => {
      const raw = window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY);
      expect(raw).toContain('"x":0');
      expect(raw).toContain('"y":0');
      expect(raw).toContain('"zoom":1');
    });
  });

  it('does not split topology layout by list-only filters（列表筛选不应拆分拓扑布局工作区）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));
    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 822, y: 234 });
    });

    fireEvent.click(screen.getByRole('button', { name: '节点' }));
    fireEvent.click(screen.getByTestId('agent-list-filter-agent'));
    fireEvent.click(screen.getByRole('button', { name: '拓扑图' }));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 822, y: 234 });
    });
  });

  it('restores manual layout after auto mode and ignores status-only changes（自动布局不覆盖手动布局且状态变化不丢布局）', async () => {
    const firstRender = render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));
    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 822, y: 234 });
    });

    fireEvent.click(screen.getByTestId('agent-topology-layout-mode-auto-flow'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
      expect(reactFlowRuntime.fitView).toHaveBeenCalled();
    });

    reactFlowRuntime.setViewport.mockClear();
    fireEvent.click(screen.getByTestId('agent-topology-layout-mode-manual'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 822, y: 234 });
      expect(reactFlowRuntime.setViewport).toHaveBeenCalled();
    });

    firstRender.unmount();
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue(createRuntimeSnapshot('busy'));
    render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 822, y: 234 });
    });
  });

  it('supports fit view, reset current layout, and clear saved layouts actions（支持适配视口/重置布局/清空布局动作）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
    });

    reactFlowRuntime.fitView.mockClear();
    fireEvent.click(screen.getByTestId('agent-topology-fit-view'));

    await waitFor(() => {
      expect(reactFlowRuntime.fitView).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 711, y: 157 });
      expect(window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY)).toContain('agent:classifier');
    });

    fireEvent.click(screen.getByTestId('agent-topology-reset-layout'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
      expect(window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY)).toBeNull();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-drag-agent:classifier'));

    await waitFor(() => {
      expect(window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY)).toContain('agent:classifier');
    });

    fireEvent.click(screen.getByTestId('agent-topology-clear-layouts'));

    await waitFor(() => {
      expect(readClassifierPosition()).toEqual({ x: 600, y: 80 });
      expect(window.localStorage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY)).toBeNull();
    });
  });
});
