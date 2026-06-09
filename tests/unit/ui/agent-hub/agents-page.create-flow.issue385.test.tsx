import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { createProviderProfile } from '@/lib/agent-provider/provider-profile-storage';
import type { SignalRoute } from '@/lib/types/signal-pool';

const serviceMocks = vi.hoisted(() => ({
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
  getConversation: vi.fn(),
  streamConversation: vi.fn(),
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

describe('agents page create flow issue-385（Agent Hub 创建流）', () => {
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

  it('shows Claude CLI / Codex CLI / API Agent and auto-directs single target（展示新节点类型并在单目标时自动直达）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();
    });

    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('API Agent')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-add-node-option-claude_cli'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-create-sheet')).toBeInTheDocument();
      expect(screen.getByText('单目标自动直达：Embedded Runtime')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-create-submit'));

    await waitFor(() => {
      expect(runtimeClientMocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'host-embedded',
          host: '127.0.0.1',
          port: 1949,
        }),
        expect.objectContaining({
          kind: 'claude_cli',
        }),
      );
    });
  });

  it('uses runtime_host.capabilities when legacy flat capabilities are absent（缺少旧 capabilities 时仍读取 runtime_host.capabilities）', async () => {
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-07T10:10:00.000Z',
      agents: [],
      hosts: [
        {
          host: {
            id: 'host-claude-nested',
            name: 'Claude Nested Runtime',
            host: '127.0.0.1',
            port: 1949,
            status: 'unknown',
            createdAt: '2026-03-07T00:00:00.000Z',
            updatedAt: '2026-03-07T00:00:00.000Z',
          },
          connectionState: 'online' as const,
          agents: [],
          topology: {
            runtime_host: {
              host_id: 'claude-runtime-host',
              hostname: 'claude-runtime',
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
            device: {
              id: 'claude-runtime-host',
              name: 'Hope Desktop',
              kind: 'desktop',
              primary_runtime_host_id: 'claude-runtime-host',
            },
            device_components: [],
            device_links: [],
          },
        },
        {
          host: {
            id: 'host-api-nested',
            name: 'API Only Runtime',
            host: '192.168.1.90',
            port: 1950,
            status: 'unknown',
            createdAt: '2026-03-07T00:00:00.000Z',
            updatedAt: '2026-03-07T00:00:00.000Z',
          },
          connectionState: 'online' as const,
          agents: [],
          topology: {
            runtime_host: {
              host_id: 'api-runtime-host',
              hostname: 'api-runtime',
              os: 'Android',
              arch: 'aarch64',
              uptime_secs: 240,
              version: '0.3.6',
              port: 1950,
              capabilities: {
                agent_kinds: ['api'],
                api_providers: ['openai', 'anthropic'],
              },
            },
            device: {
              id: 'api-runtime-host',
              name: 'Pocket Device',
              kind: 'phone',
              primary_runtime_host_id: 'api-runtime-host',
            },
            device_components: [],
            device_links: [],
          },
        },
      ],
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));
    fireEvent.click(await screen.findByTestId('agent-add-node-option-claude_cli'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-create-sheet')).toBeInTheDocument();
      expect(screen.getByText('单目标自动直达：Claude Nested Runtime')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-create-submit'));

    await waitFor(() => {
      expect(runtimeClientMocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'host-claude-nested',
          host: '127.0.0.1',
          port: 1949,
        }),
        expect.objectContaining({
          kind: 'claude_cli',
        }),
      );
    });
  });

  it('requires explicit runtime target for multi-target API agent and reuses saved profile（多目标 API Agent 需显式选 Runtime 并复用已保存 Profile）', async () => {
    const profile = createProviderProfile({
      name: 'OpenAI GPT-5',
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-add-node-sheet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-option-api'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-create-sheet')).toBeInTheDocument();
      expect(screen.getByTestId('agent-create-provider-profile-select')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('OpenAI GPT-5 · openai / gpt-5')).toBeInTheDocument();
    expect(screen.getByTestId('agent-create-provider-select')).toBeDisabled();
    expect(screen.getByTestId('agent-create-model-input')).toBeDisabled();
    expect(screen.getByTestId('agent-create-api-key-input')).toBeDisabled();

    fireEvent.click(screen.getByTestId('agent-create-submit'));

    await waitFor(() => {
      expect(screen.getByText('存在多个可用 Runtime，请先显式选择一个目标')).toBeInTheDocument();
    });

    expect(runtimeClientMocks.createAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agent-create-runtime-host-host-termux'));
    fireEvent.click(screen.getByTestId('agent-create-submit'));

    await waitFor(() => {
      expect(runtimeClientMocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'host-termux',
          host: '192.168.1.88',
          port: 1950,
        }),
        expect.objectContaining({
          kind: 'api',
          providerProfile: expect.objectContaining({
            profileId: profile.profileId,
            provider: 'openai',
            model: 'gpt-5',
            apiKey: 'sk-test',
          }),
        }),
      );
    });
  });

  it('blocks fallback target that does not support requested kind（fallback 目标不支持时前端应先拦截）', async () => {
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-07T10:30:00.000Z',
      agents: [],
      hosts: [],
    });
    runtimeManagerMocks.addHostFromAddress.mockResolvedValue({
      id: 'host-fallback',
      name: 'Selected Runtime',
      host: '127.0.0.1',
      port: 1949,
      status: 'unknown',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
    });
    runtimeClientMocks.getTopology.mockResolvedValue({
      ok: true,
      data: {
        host_id: 'fallback-host',
        hostname: 'fallback-runtime',
        os: 'Windows 11',
        arch: 'x64',
        uptime_secs: 33,
        version: '0.3.6',
        port: 1949,
        capabilities: {
          agent_kinds: ['api'],
          api_providers: ['openai'],
        },
      },
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-add-node-button'));
    fireEvent.click(await screen.findByTestId('agent-add-node-option-claude_cli'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-create-sheet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-create-submit'));

    await waitFor(() => {
      expect(screen.getByText('当前 Runtime 不支持所选 Agent 类型')).toBeInTheDocument();
    });

    expect(runtimeClientMocks.getTopology).toHaveBeenCalled();
    expect(runtimeClientMocks.createAgent).not.toHaveBeenCalled();
  });
});
