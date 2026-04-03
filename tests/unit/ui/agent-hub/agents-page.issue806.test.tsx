import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
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
}));

const runtimeControlMocks = vi.hoisted(() => ({
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
}));

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
    onInitialConnectionFailure,
  }: {
    ptyId: string;
    onInitialConnectionFailure?: () => void;
  }) => (
    <div data-testid={`mock-pty-terminal-${ptyId}`}>
      PTY:{ptyId}
      {onInitialConnectionFailure ? (
        <button
          type="button"
          data-testid={`mock-pty-terminal-fail-${ptyId}`}
          onClick={() => onInitialConnectionFailure()}
        >
          fail
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
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

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-issue-806',
    agent_kind: 'codex',
    role: 'Codex 806',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-live-806',
    inner_session_id: 'codex-thread-806',
    source_host_id: 'runtime-host-523',
    context: {
      issue_refs: [],
      labels: [],
      work_dir: 'D:/project/exomind',
    },
    created_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

function buildRuntimeSnapshot() {
  return {
    updatedAt: '2026-04-02T10:00:00.000Z',
    agents: [],
    hosts: [
      {
        host: {
          id: 'host-523',
          name: '127.0.0.1:1919',
          host: '127.0.0.1',
          port: 1919,
          status: 'unknown' as const,
          createdAt: '2026-04-02T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
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

describe('agents page issue-806（终端恢复误判防风暴）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    sessionStreamState.sessions = [buildSession({})];

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
      yield { messageId: 'fallback-806', delta: 'fallback', done: true };
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
    runtimeClientMocks.createAgent.mockResolvedValue({ ok: true, data: { id: 'agent-806' } });
    runtimeClientMocks.deleteAgent.mockResolvedValue({ ok: true, data: { status: 'stopped', id: 'agent-806' } });
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-live-806',
        name: 'Codex 806',
        session_id: null,
        workdir: 'D:/project/exomind',
        command: 'codex',
        status: 'running',
        created_at: '2026-04-02T00:00:00.000Z',
      },
    });
    runtimeClientMocks.updateSession.mockResolvedValue({
      ok: true,
      data: buildSession({ status: 'running' }),
    });
    runtimeClientMocks.submitQuickAction.mockResolvedValue({
      ok: true,
      data: buildSession({ status: 'running' }),
    });
    runtimeClientMocks.markSessionWaiting.mockResolvedValue({
      ok: true,
      data: buildSession({ status: 'waiting_input' }),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/signals/history')) {
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
          json: async () => [
            {
              id: 'pty-live-806',
              name: 'Codex 806',
              status: 'running',
              workdir: 'D:/project/exomind',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-806',
            name: 'Codex 806 Resumed',
          }),
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

  it('does not auto-resume when the PTY is still live after a terminal stream failure（流失败但 PTY 仍在线时不应误触发 resume）', async () => {
    render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-live-806');
    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-pty-terminal-fail-pty-live-806'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-rightpanel-pty-disconnected')).not.toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);
  });

  it('retries codex auto-resume after the runtime becomes reachable again（RT 恢复可达后应再次自动恢复，而不是烧掉唯一尝试机会）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sessionStreamState.sessions = [
      buildSession({
        source_host_id: 'stale-runtime-host-806',
      }),
    ];
    let initialLivePtyServed = false;
    let runtimeReachable = false;
    let resumePosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes('/signals/history')) {
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
              session_id: 'codex-thread-806',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        if (!initialLivePtyServed) {
          initialLivePtyServed = true;
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'pty-live-806',
                name: 'Codex 806',
                status: 'running',
                workdir: 'D:/project/exomind',
              },
            ],
          } as Response;
        }
        if (!runtimeReachable) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'runtime unavailable' }),
            text: async () => 'runtime unavailable',
          } as Response;
        }
        if (!resumePosted) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'pty-resumed-806',
              name: 'Codex 806 Resumed',
              status: 'running',
              workdir: 'D:/project/exomind',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-806',
            name: 'Codex 806 Resumed',
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-live-806');
    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-pty-terminal-fail-pty-live-806'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);

    runtimeReachable = true;
    sessionStreamState.sessions = [
      buildSession({
        source_host_id: 'stale-runtime-host-806',
        last_active_at: '2026-04-02T00:00:01.000Z',
      }),
    ];
    rerender(<AgentsPage />);

    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
      ).toHaveLength(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-806')).toBeInTheDocument();
    });

    expect(runtimeClientMocks.updateSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      'session-issue-806',
      { status: 'completed' },
    );
    expect(runtimeClientMocks.updateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      'session-issue-806',
      { status: 'archived' },
    );

    warnSpy.mockRestore();
  });

  it('retries claude auto-resume after the runtime becomes reachable again（Claude 断连后也应自动恢复）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sessionStreamState.sessions = [
      buildSession({
        agent_kind: 'claude',
        role: 'Claude 806',
        inner_session_id: 'claude-thread-806',
        source_host_id: 'stale-runtime-host-806',
      }),
    ];
    let initialLivePtyServed = false;
    let runtimeReachable = false;
    let resumePosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
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
          json: async () => [
            {
              agent_type: 'claude',
              session_id: 'claude-thread-806',
              project_path: 'D--project-exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        if (!initialLivePtyServed) {
          initialLivePtyServed = true;
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'pty-live-806',
                name: 'Claude 806',
                status: 'running',
                workdir: 'D:/project/exomind',
              },
            ],
          } as Response;
        }
        if (!runtimeReachable) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'runtime unavailable' }),
            text: async () => 'runtime unavailable',
          } as Response;
        }
        if (!resumePosted) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'pty-resumed-claude-806',
              name: 'Claude 806 Resumed',
              status: 'running',
              workdir: 'D:/project/exomind',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-claude-806',
            name: 'Claude 806 Resumed',
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-live-806');
    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-pty-terminal-fail-pty-live-806'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);

    runtimeReachable = true;
    sessionStreamState.sessions = [
      buildSession({
        agent_kind: 'claude',
        role: 'Claude 806',
        inner_session_id: 'claude-thread-806',
        source_host_id: 'stale-runtime-host-806',
        last_active_at: '2026-04-02T00:00:01.000Z',
      }),
    ];
    rerender(<AgentsPage />);

    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
      ).toHaveLength(1);
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://127.0.0.1:1919/pty/resume',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          agent_type: 'claude',
          session_id: 'claude-thread-806',
          name: 'Claude 806',
          workdir: 'D:/project/exomind',
        }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-claude-806')).toBeInTheDocument();
    });

    warnSpy.mockRestore();
  });
});
