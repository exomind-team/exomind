import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';

import type { SignalRoute } from '@/lib/types/signal-pool';

const serviceMocks = vi.hoisted(() => ({
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
  getConversation: vi.fn(),
  streamConversation: vi.fn(),
}));

const layoutState = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => layoutState.isDesktop,
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

const runtimeClientMocks = vi.hoisted(() => ({
  streamAgentConversation: vi.fn(),
  getTopology: vi.fn(),
  getAgents: vi.fn(),
  getAllEnergy: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getAgentEnergy: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    children,
    onNodeClick,
  }: {
    nodes?: Array<{ id: string; data?: { label?: string } }>;
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
      {children}
    </div>
  ),
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: () => <div data-testid="mock-react-flow-controls" />,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()] as const,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getAgentHubService: () => ({
      getDeviceView: serviceMocks.getDeviceView,
      getAgentDetail: serviceMocks.getAgentDetail,
      getActorDetail: serviceMocks.getActorDetail,
      getConversation: serviceMocks.getConversation,
      streamConversation: serviceMocks.streamConversation,
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

vi.mock('@/services/runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtime-client')>();
  class RuntimeClientMock {
    streamAgentConversation = runtimeClientMocks.streamAgentConversation;

    getTopology = runtimeClientMocks.getTopology;

    getAgents = runtimeClientMocks.getAgents;

    getAllEnergy = runtimeClientMocks.getAllEnergy;

    createAgent = runtimeClientMocks.createAgent;

    deleteAgent = runtimeClientMocks.deleteAgent;

    getAgentEnergy = runtimeClientMocks.getAgentEnergy;
  }

  return {
    ...actual,
    RuntimeClient: RuntimeClientMock,
  };
});

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-385-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'claude',
    created_at: '2026-03-07T00:00:00Z',
    updated_at: '2026-03-07T00:00:00Z',
  },
];

function buildRuntimeSnapshot() {
  return {
    updatedAt: '2026-03-07T10:00:00.000Z',
    agents: [],
    hosts: [
      {
        host: {
          id: 'host-embedded',
          name: 'Embedded Runtime',
          host: '127.0.0.1',
          port: 1949,
          status: 'unknown',
          createdAt: '2026-03-07T00:00:00.000Z',
          updatedAt: '2026-03-07T00:00:00.000Z',
        },
        connectionState: 'online' as const,
        agents: [],
        topology: {
          host_id: 'embedded-runtime-host',
          hostname: 'embedded-runtime',
          os: 'Windows 11',
          arch: 'x64',
          uptime_secs: 90,
          version: '0.3.6',
          port: 1949,
          capabilities: {
            agent_kinds: ['claude_cli', 'api'],
            api_providers: ['openai'],
          },
        },
      },
      {
        host: {
          id: 'host-termux',
          name: 'Termux Runtime',
          host: '192.168.1.88',
          port: 1950,
          status: 'unknown',
          createdAt: '2026-03-07T00:00:00.000Z',
          updatedAt: '2026-03-07T00:00:00.000Z',
        },
        connectionState: 'online' as const,
        agents: [],
        topology: {
          host_id: 'termux-runtime-host',
          hostname: 'termux-runtime',
          os: 'Android',
          arch: 'aarch64',
          uptime_secs: 240,
          version: '0.3.6',
          port: 1950,
          capabilities: {
            agent_kinds: ['codex_cli', 'api'],
            api_providers: ['openai', 'anthropic'],
          },
        },
      },
    ],
  };
}

describe('Alpha device connection flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1949,
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1949,
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue(buildRuntimeSnapshot());
    runtimeManagerMocks.addHostFromAddress.mockResolvedValue({
      id: 'host-selected-runtime',
      name: 'Selected Runtime',
      host: '127.0.0.1',
      port: 1949,
      status: 'unknown',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
    });

    serviceMocks.getDeviceView.mockResolvedValue([]);
    serviceMocks.getAgentDetail.mockResolvedValue(null);
    serviceMocks.getActorDetail.mockResolvedValue(null);
    serviceMocks.getConversation.mockResolvedValue([]);
    serviceMocks.streamConversation.mockImplementation(async function* () {
      yield { messageId: 'fallback-1', delta: 'fallback', done: true };
    });

    runtimeClientMocks.createAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'created-agent-1',
        name: 'Created Agent',
        description: 'runtime created agent',
        status: 'available',
      },
    });
    runtimeClientMocks.getAgentEnergy.mockResolvedValue(null);
    runtimeClientMocks.getAgents.mockResolvedValue({ ok: true, data: [] });
    runtimeClientMocks.getAllEnergy.mockResolvedValue({ ok: true, data: [] });
    runtimeClientMocks.getTopology.mockResolvedValue({
      ok: true,
      data: buildRuntimeSnapshot().hosts[0].topology,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_SIGNAL_ROUTES,
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  it.each([false, true])('retains device connection and closes Agent creation with desktop=%s', async (isDesktop) => {
    layoutState.isDesktop = isDesktop;
    localStorage.setItem('exomind:apiAgentTabEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
    render(<AgentsPage />);
    await screen.findByTestId('agent-device-view');
    fireEvent.click(screen.getByTestId('agent-add-node-button'));

    expect(screen.getAllByTestId(/agent-add-node-option-/)).toHaveLength(1);
    expect(screen.queryByText('Claude CLI')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex CLI')).not.toBeInTheDocument();
    expect(screen.queryByText('API Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Echo Agent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-add-node-option-device'));

    expect(screen.getByTestId('agent-host-manager-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-add-node-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-create-sheet')).not.toBeInTheDocument();
    expect(runtimeClientMocks.createAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('agent-host-manager-close'));
    expect(screen.getByTestId('agent-device-view')).toBeInTheDocument();
  });
});
