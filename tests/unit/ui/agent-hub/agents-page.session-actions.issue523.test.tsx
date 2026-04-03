import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalRoute } from '@/lib/types/signal-pool';
import type { SessionInfo } from '@/lib/types/session';
import { AGENTS_TILED_PERSISTENCE_STORAGE_KEY } from '@/ui/app/pages/agents/agents-tiled-persistence';

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
  stopPtyAgent: vi.fn(),
  updateSession: vi.fn(),
  submitQuickAction: vi.fn(),
  markSessionWaiting: vi.fn(),
}));

const sessionStreamState = vi.hoisted(() => ({
  sessions: [] as SessionInfo[],
  refresh: vi.fn(),
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

vi.mock('@/hooks/useSessionStream', () => ({
  useSessionStream: () => ({
    sessions: sessionStreamState.sessions,
    loading: false,
    error: null,
    refresh: sessionStreamState.refresh,
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

    stopPtyAgent = runtimeClientMocks.stopPtyAgent;

    updateSession = runtimeClientMocks.updateSession;

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

class MockEventSource {
  constructor(_url: string) {}

  addEventListener() {}

  removeEventListener() {}

  close() {}
}

describe('agents page session actions issue-523（会话动作接线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
    sessionStreamState.refresh.mockReset();

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
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-523',
        name: 'Terminal Agent',
        session_id: null,
        workdir: 'D:/project/exomind',
        command: 'claude',
        status: 'stopped',
        created_at: '2026-03-14T00:00:00.000Z',
      },
    });
    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        status: request.status ?? 'running',
      }),
    }));
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
      if (url.includes('/pty/sessions?agent_type=claude')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: '019d0011-aaaa-bbbb-cccc-1234567890ab',
              project_path: 'D:/project/exomind',
              last_modified: '2026-03-18T02:20:32.696Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resume-523',
            name: 'Codex-019d0011',
          }),
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'pty-523',
              name: 'Terminal Agent',
              status: 'running',
              workdir: 'D:/project/exomind',
            },
          ],
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

  it('stops PTY terminal agent from the right panel（右侧终端面板可真正停止 Terminal Agent）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-flow-node-pty-pty-523')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-pty-pty-523'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-stop-pty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('agent-rightpanel-pty-terminal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-rightpanel-stop-pty'));

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'pty-523',
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('agent-rightpanel-pty-terminal')).not.toBeInTheDocument();
    });
  });

  it('uses matching session host context when opening a pty topology node（点击 pty 拓扑节点时优先使用匹配 session 的 host 上下文）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-topology-pty',
        role: 'Issue 806 Terminal',
        interaction_mode: 'terminal',
        pty_id: 'pty-523',
        source_host_id: 'runtime-host-remote',
      }),
    ];
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-14T10:00:00.000Z',
      agents: [],
      hosts: [
        ...buildRuntimeSnapshot().hosts,
        {
          host: {
            id: 'host-remote',
            name: '127.0.0.1:9124',
            host: '127.0.0.1',
            port: 9124,
            status: 'unknown' as const,
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T00:00:00.000Z',
          },
          connectionState: 'online' as const,
          agents: [],
          topology: {
            host_id: 'runtime-host-remote',
            hostname: 'runtime-host-remote',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 90,
            version: '0.3.6',
            port: 9124,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli', 'api'],
              api_providers: ['openai', 'anthropic'],
            },
          },
        },
      ],
    });

    render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-523');
    expect(topologyNode).toHaveTextContent('Issue 806 Terminal');

    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-stop-pty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-stop-pty'));

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 9124 }),
        'pty-523',
      );
    });
  });

  it('stops PTY terminal agent from session list card（会话列表卡片可真正停止 Terminal Agent）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-card-stop',
        interaction_mode: 'terminal',
        pty_id: 'pty-523',
        source_host_id: 'runtime-host-523',
      }),
    ];

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));

    await waitFor(() => {
      expect(screen.getByTestId('session-card-stop-session-card-stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-card-stop-session-card-stop'));

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'pty-523',
      );
    });
  });

  it('reconciles stale terminal sessions from the right panel when PTY stop returns 404（右侧面板可将丢失 PTY 的会话收敛为已完成）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-stale-stop',
        role: 'Stale Terminal',
        interaction_mode: 'terminal',
        pty_id: 'pty-stale',
        source_host_id: 'runtime-host-523',
      }),
    ];
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: false,
      error: {
        status: 404,
        message: 'PTY instance not found: pty-stale',
      },
    });
    runtimeClientMocks.updateSession.mockResolvedValue({
      ok: true,
      data: buildSession({
        id: 'session-stale-stop',
        role: 'Stale Terminal',
        status: 'completed',
        interaction_mode: 'terminal',
        pty_id: 'pty-stale',
        source_host_id: 'runtime-host-523',
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
      if (url.includes('/pty/sessions?agent_type=')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-523',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
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

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));

    fireEvent.click(await screen.findByTestId('session-card-session-stale-stop'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('agent-rightpanel-stop-pty')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-stop-pty'));

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'pty-stale',
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-stale-stop',
        { status: 'completed' },
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('agent-rightpanel-pty-terminal')).not.toBeInTheDocument();
    });
  });

  it('reconciles a disconnected persisted PTY via fresh /sessions lookup when in-memory sessions are missing（内存会话缺失时仍可回源 /sessions 收敛断开 PTY）', async () => {
    sessionStreamState.sessions = [];
    localStorage.setItem(
      AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        layout: '2x2',
        paneOrder: [],
        fullscreenPtyId: 'pty-stale-fresh-fetch',
      }),
    );

    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: false,
      error: {
        status: 404,
        message: 'PTY instance not found: pty-stale-fresh-fetch',
      },
    });
    runtimeClientMocks.updateSession.mockResolvedValue({
      ok: true,
      data: buildSession({
        id: 'session-stale-fresh-fetch',
        role: 'Fresh Session Lookup',
        status: 'completed',
        interaction_mode: 'terminal',
        pty_id: 'pty-stale-fresh-fetch',
        source_host_id: 'runtime-host-523',
      }),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/sessions')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'session-stale-fresh-fetch',
              agent_kind: 'claude',
              role: 'Fresh Session Lookup',
              summary: '',
              status: 'running',
              interaction_mode: 'terminal',
              pty_id: 'pty-stale-fresh-fetch',
              source_host_id: 'runtime-host-523',
              context: {
                issue_refs: [],
                labels: [],
              },
              created_at: '2026-03-14T00:00:00.000Z',
              last_active_at: '2026-03-14T00:00:00.000Z',
              turn_count: 0,
            },
          ],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=')) {
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('agent-rightpanel-stop-pty')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-stop-pty'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/sessions',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-stale-fresh-fetch',
        { status: 'completed' },
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('agent-rightpanel-pty-terminal')).not.toBeInTheDocument();
    });
  });

  it('shows an error when terminal stop throws a network error（右侧面板停止终端遇到网络异常时不再静默）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-stop-network-error',
        role: 'Stale Terminal',
        interaction_mode: 'terminal',
        pty_id: 'pty-network-error',
        source_host_id: 'runtime-host-523',
      }),
    ];
    runtimeClientMocks.stopPtyAgent.mockRejectedValue(new Error('Failed to fetch'));
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
      if (url.includes('/pty/sessions?agent_type=')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-523',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
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

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-stop-network-error'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-stop-pty'));

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'pty-network-error',
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[agent-hub][pty] stop action threw',
        expect.objectContaining({
          ptyId: 'pty-network-error',
          sourceHostId: 'runtime-host-523',
          hostAddress: '127.0.0.1:1919',
          message: 'Failed to fetch',
        }),
      );
    });

    consoleWarnSpy.mockRestore();
  });

  it('opens PTY spawn dialog and resumes codex history（Agents 页可恢复 Codex 历史会话）', async () => {
    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('pty-spawn-button'));

    await waitFor(() => {
      expect(screen.getByTestId('pty-agent-type')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('pty-agent-type'), { target: { value: 'codex' } });

    await waitFor(() => {
      expect(screen.getByTestId('pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            agent_type: 'codex',
            session_id: '019d0011-aaaa-bbbb-cccc-1234567890ab',
            reasoning_effort: 'xhigh',
          }),
        }),
      );
    });
  });

  it('backfills missing Codex inner_session_id for running PTY sessions（运行中的 Codex PTY 会补写 inner_session_id）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-codex-bind',
        agent_kind: 'codex',
        role: 'Codex Bind',
        status: 'running',
        interaction_mode: 'terminal',
        pty_id: 'pty-codex-bind',
        source_host_id: 'runtime-host-523',
        created_at: '2026-04-02T00:00:00.000Z',
        last_active_at: '2026-04-02T00:00:00.000Z',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/pty/sessions?agent_type=claude')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-bind',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:05:00.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/session-codex-bind') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'session-codex-bind',
            inner_session_id: 'codex-thread-bind',
          }),
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'pty-codex-bind',
              name: 'Codex Bind',
              status: 'running',
              workdir: 'D:/project/exomind',
            },
          ],
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => {
        if (!String(input).endsWith('/sessions/session-codex-bind')) {
          return false;
        }
        if (init?.method !== 'PATCH') {
          return false;
        }
        const headers = new Headers(init.headers);
        return headers.get('Content-Type') === 'application/json'
          && init.body === JSON.stringify({ inner_session_id: 'codex-thread-bind' });
      })).toBe(true);
    });
  });

  it('keeps persisted fullscreen PTY visible as disconnected after RT state loss（持久化全屏 PTY 丢失后保留断开态）', async () => {
    sessionStreamState.sessions = [];
    localStorage.setItem(
      AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        layout: '2x2',
        paneOrder: [],
        fullscreenPtyId: 'pty-missing',
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=')) {
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    expect(localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY)).toContain('pty-missing');
  });

  it('treats a completed PTY session from a disappeared host as disconnected and lets the user archive it（旧 host 的已完成 PTY 会话应进入断开态并可归档）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-completed-stale-host',
        agent_kind: 'codex',
        role: 'Completed Stale Host',
        status: 'completed',
        interaction_mode: 'terminal',
        pty_id: 'pty-completed-stale-host',
        source_host_id: 'runtime-host-old',
      }),
    ];
    localStorage.setItem(
      AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        layout: '2x2',
        paneOrder: [],
        fullscreenPtyId: 'pty-completed-stale-host',
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=')) {
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-rightpanel-archive-session')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-rightpanel-stop-pty')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-rightpanel-archive-session'));

    await waitFor(() => {
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-completed-stale-host',
        { status: 'archived' },
      );
    });
    await waitFor(() => {
      expect(sessionStreamState.refresh).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('agent-rightpanel-pty-terminal')).not.toBeInTheDocument();
    });
  });

  it('keeps disconnected Codex PTY in readonly mode when historical session validation fails（历史 session 校验失败时不串线恢复 Codex）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-codex-stale',
        agent_kind: 'codex',
        role: 'Codex Resume',
        status: 'running',
        interaction_mode: 'terminal',
        pty_id: 'pty-codex-stale',
        inner_session_id: 'codex-thread-523',
        source_host_id: 'runtime-host-523',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];
    localStorage.setItem(
      AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
      JSON.stringify({
        layout: '2x2',
        paneOrder: [],
        fullscreenPtyId: 'pty-codex-stale',
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-codex-stale') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...sessionStreamState.sessions[0],
            status: init.body === JSON.stringify({ status: 'completed' }) ? 'completed' : 'archived',
          }),
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-523',
              project_path: 'D:/project/other',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://127.0.0.1:1919/pty/resume',
      expect.anything(),
    );
    expect(localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY)).toContain('pty-codex-stale');
  });
});
