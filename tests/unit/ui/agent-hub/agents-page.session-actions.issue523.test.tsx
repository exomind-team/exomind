import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalRoute } from '@/lib/types/signal-pool';
import type { SessionInfo } from '@/lib/types/session';

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
  getAgents: vi.fn(),
  getAllEnergy: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  submitQuickAction: vi.fn(),
  markSessionWaiting: vi.fn(),
}));

const sessionStreamState = vi.hoisted(() => ({
  sessions: [] as SessionInfo[],
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
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/hooks/useSessionStream', () => ({
  useSessionStream: () => ({
    sessions: sessionStreamState.sessions,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
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

    submitQuickAction = runtimeClientMocks.submitQuickAction;

    markSessionWaiting = runtimeClientMocks.markSessionWaiting;
  }

  return {
    ...actual,
    RuntimeClient: RuntimeClientMock,
  };
});

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-523-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'claude',
    created_at: '2026-03-14T00:00:00Z',
    updated_at: '2026-03-14T00:00:00Z',
  },
];

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-523',
    agent_kind: 'claude',
    role: 'Session 523',
    summary: '',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-03-14T00:00:00.000Z',
    last_active_at: '2026-03-14T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

function buildRuntimeSnapshot() {
  return {
    updatedAt: '2026-03-14T10:00:00.000Z',
    agents: [],
    hosts: [
      {
        host: {
          id: 'host-523',
          name: '127.0.0.1:1919',
          host: '127.0.0.1',
          port: 1919,
          status: 'unknown' as const,
          createdAt: '2026-03-14T00:00:00.000Z',
          updatedAt: '2026-03-14T00:00:00.000Z',
        },
        connectionState: 'online' as const,
        agents: [],
        topology: {
          host_id: 'runtime-host-523',
          hostname: 'runtime-host-523',
          os: 'Windows 11',
          arch: 'x64',
          uptime_secs: 90,
          version: '0.3.6',
          port: 1919,
          capabilities: {
            agent_kinds: ['claude_cli', 'codex_cli', 'api'],
            api_providers: ['openai', 'anthropic'],
          },
        },
      },
    ],
  };
}

describe('agents page session actions issue-523（会话动作接线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue(buildRuntimeSnapshot());

    serviceMocks.getDeviceView.mockResolvedValue([]);
    serviceMocks.getAgentDetail.mockResolvedValue(null);
    serviceMocks.getActorDetail.mockResolvedValue(null);
    serviceMocks.getConversation.mockResolvedValue([]);
    serviceMocks.streamConversation.mockImplementation(async function* () {
      yield { messageId: 'fallback-1', delta: 'fallback', done: true };
    });

    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* () {
      yield { type: 'done', content: '', done: true };
    });
    runtimeClientMocks.getTopology.mockResolvedValue({
      ok: true,
      data: buildRuntimeSnapshot().hosts[0]!.topology,
    });
    runtimeClientMocks.getAgents.mockResolvedValue({ ok: true, data: [] });
    runtimeClientMocks.getAllEnergy.mockResolvedValue({ ok: true, data: [] });
    runtimeClientMocks.createAgent.mockResolvedValue({ ok: true, data: { id: 'agent-523' } });
    runtimeClientMocks.deleteAgent.mockResolvedValue({ ok: true, data: { status: 'stopped', id: 'agent-523' } });
    runtimeClientMocks.submitQuickAction.mockResolvedValue({
      ok: true,
      data: buildSession({
        id: 'session-quick',
        status: 'running',
      }),
    });
    runtimeClientMocks.markSessionWaiting.mockResolvedValue({
      ok: true,
      data: buildSession({
        id: 'session-terminal',
        status: 'waiting_input',
        interaction_mode: 'terminal',
      }),
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
      if (url.includes('/signals/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
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

  it('submits session quick actions through RuntimeClient（点击 quick action 应调用 RuntimeClient.submitQuickAction）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-quick',
        status: 'waiting_input',
        quick_actions: [
          {
            id: 'continue',
            label: '继续',
            action_type: 'button',
          },
        ],
      }),
    ];

    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '平铺' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    await waitFor(() => {
      expect(runtimeClientMocks.submitQuickAction).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-quick',
        { action_id: 'continue', value: undefined },
      );
    });
  });

  it('marks running terminal sessions as waiting through RuntimeClient（点击等待决策应调用 RuntimeClient.markSessionWaiting）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-terminal',
        status: 'running',
        interaction_mode: 'terminal',
      }),
    ];

    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '平铺' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '等待决策' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '等待决策' }));

    await waitFor(() => {
      expect(runtimeClientMocks.markSessionWaiting).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-terminal',
      );
    });
  });

  it('falls back to embedded runtime host when no runtime snapshots exist（无快照时回退到 embedded runtime host）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-fallback',
        status: 'waiting_input',
        quick_actions: [
          {
            id: 'continue',
            label: '继续',
            action_type: 'button',
          },
        ],
      }),
    ];

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-14T10:00:00.000Z',
      agents: [],
      hosts: [],
    });

    render(<AgentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '平铺' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续' }));

    await waitFor(() => {
      expect(runtimeClientMocks.submitQuickAction).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 9124 }),
        'session-fallback',
        { action_id: 'continue', value: undefined },
      );
    });
  });
});
