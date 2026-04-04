import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
}));

const runtimeClientMocks = vi.hoisted(() => ({
  streamAgentConversation: vi.fn(),
  getTopology: vi.fn(),
  getAgents: vi.fn(),
  getAllEnergy: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  stopPtyAgent: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  submitQuickAction: vi.fn(),
  markSessionWaiting: vi.fn(),
}));

const sessionStreamState = vi.hoisted(() => ({
  sessions: [] as SessionInfo[],
}));

const ptyTerminalMockState = vi.hoisted(() => ({
  nextMountSerial: 0,
}));

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
    onInitialConnectionFailure,
  }: {
    ptyId: string;
    onInitialConnectionFailure?: () => void;
  }) => {
    const React = require('react') as typeof import('react');
    const [mountSerial] = React.useState(() => {
      ptyTerminalMockState.nextMountSerial += 1;
      return ptyTerminalMockState.nextMountSerial;
    });
    return (
      <div data-testid={`mock-pty-terminal-${ptyId}`} data-mount-serial={mountSerial}>
        PTY:{ptyId}
        <span data-testid={`mock-pty-terminal-mount-${ptyId}`}>{mountSerial}</span>
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
    );
  },
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

    getSession = runtimeClientMocks.getSession;

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

function buildSnapshot(overrides: {
  host?: Record<string, unknown>;
  topology?: Record<string, unknown>;
} = {}) {
  return {
    host: {
      id: 'snapshot-host-806',
      name: '127.0.0.1:1919',
      host: '127.0.0.1',
      port: 1919,
      status: 'unknown' as const,
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      ...(overrides.host ?? {}),
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
      ...(overrides.topology ?? {}),
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    ptyTerminalMockState.nextMountSerial = 0;

    sessionStreamState.sessions = [buildSession({})];

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-523',
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-523',
      pid: 1234,
      error: null,
    });
    runtimeControlMocks.stopRuntime.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-523',
      pid: null,
      error: null,
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
    runtimeClientMocks.getSession.mockResolvedValue({
      ok: true,
      data: buildSession({ status: 'running' }),
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

  it('remounts the active PTY terminal when the same session card is reopened（重复点击当前会话卡片时应重新挂载终端）', async () => {
    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-issue-806'));

    const initialMount = await screen.findByTestId('mock-pty-terminal-mount-pty-live-806');
    const firstMountSerial = initialMount.textContent;
    expect(firstMountSerial).not.toBeNull();

    fireEvent.click(await screen.findByTestId('session-card-session-issue-806'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-mount-pty-live-806').textContent).not.toBe(firstMountSerial);
    });
  });

  it('emits agent-hub PTY open traces when opening a topology PTY node（点击拓扑 PTY 节点时应输出可追溯日志）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-live-806');
    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    expect(infoSpy).toHaveBeenCalledWith(
      '[agent-hub][pty][open] requested',
      expect.objectContaining({
        origin: 'topology-node',
        sessionId: 'session-issue-806',
        ptyId: 'pty-live-806',
      }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[agent-hub][pty][open] terminal panel opened',
      expect.objectContaining({
        origin: 'topology-node',
        sessionId: 'session-issue-806',
        ptyId: 'pty-live-806',
      }),
    );
  });

  it('logs and surfaces a disconnected state when the PTY liveness recheck times out after initial stream failure（初始流失败后若 /pty 复核超时应有日志与失败态）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let shouldTimeout = false;

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
        if (shouldTimeout) {
          throw new Error('request timeout（请求超时）');
        }
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

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    const topologyNode = await screen.findByTestId('mock-react-flow-node-pty-pty-live-806');
    fireEvent.click(topologyNode);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    shouldTimeout = true;
    fireEvent.click(screen.getByTestId('mock-pty-terminal-fail-pty-live-806'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('agent-runtime-error-banner')).toHaveTextContent(
        'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
      );
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected-message')).toHaveTextContent(
        'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
      );
    });

    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][connect] initial terminal stream failed; rechecking PTY liveness'
      && (payload as { ptyId?: string }).ptyId === 'pty-live-806'
    ))).toBe(true);
    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][connect] PTY liveness recheck failed after initial stream failure'
      && (payload as { ptyId?: string; timeout?: boolean }).ptyId === 'pty-live-806'
      && (payload as { ptyId?: string; timeout?: boolean }).timeout === true
    ))).toBe(true);
    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][connect] marking PTY as disconnected after initial stream failure'
      && (payload as { ptyId?: string }).ptyId === 'pty-live-806'
    ))).toBe(true);

    warnSpy.mockRestore();
  });

  it('switches the active PTY to disconnected history when RT stop makes /pty refresh fail（RT stop 导致 /pty 刷新失败后应立即切到断开历史态）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let runtimeReachable = true;

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
        if (!runtimeReachable) {
          throw new Error('runtime down');
        }
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

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('mock-react-flow-node-pty-pty-live-806'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    fireEvent.click(await screen.findByTestId('agent-view-toggle-device'));
    runtimeReachable = false;
    fireEvent.click(await screen.findByTestId('runtime-local-stop-button'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('agent-runtime-error-banner')).toHaveTextContent(
        'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
      );
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected-message')).toHaveTextContent(
        'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
      );
    });

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/pty')).length).toBeGreaterThanOrEqual(2);
    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] marking current host PTYs as disconnected because refresh failed'
      && (payload as { ptyIds?: string[] }).ptyIds?.includes('pty-live-806')
    ))).toBe(true);

    warnSpy.mockRestore();
  });

  it('keeps recoverable embedded sessions active while the runtime is temporarily stopped and the source host cannot yet be resolved（embedded RT 暂停期间不应因 host 暂未解析就提前收敛可恢复会话）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-embedded-restart-824',
        pty_id: 'pty-embedded-restart-824',
        inner_session_id: 'codex-thread-embedded-restart-824',
        source_host_id: 'runtime-host-restarting-824',
      }),
    ];
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-current-824',
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-04-03T10:00:00.000Z',
      agents: [],
      hosts: [],
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
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-embedded-restart-824',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-03T00:00:05.000Z',
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
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pty'))).toBe(true);
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-embedded-restart-824',
      { status: 'completed' },
    );
    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] keep disconnected terminal session active while embedded runtime is restarting'
      && (payload as { sessionId?: string }).sessionId === 'session-embedded-restart-824'
    ))).toBe(true);

    infoSpy.mockRestore();
  });

  it('keeps a newly opened PTY live until a fresh PTY list confirms it is missing（新 PTY 不应在列表刷新前被立即误判断开）', async () => {
    sessionStreamState.sessions = [];
    const delayedPtyRefresh = createDeferred<Response>();
    let ptyListFetchCount = 0;

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
              session_id: 'claude-thread-new-806',
              project_path: 'D--project-exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-new-806') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'pty-new-806',
            inner_session_id: 'claude-thread-new-806',
          }),
        } as Response;
      }
      if (url.endsWith('/pty/spawn')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-new-806',
            name: 'Claude 806 New',
            workdir: 'D:/project/exomind',
          }),
        } as Response;
      }
      if (url.endsWith('/pty')) {
        ptyListFetchCount += 1;
        if (ptyListFetchCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          } as Response;
        }
        if (ptyListFetchCount === 2) {
          return delayedPtyRefresh.promise;
        }
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

    const { rerender } = render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('pty-spawn-button'));

    await waitFor(() => {
      expect(screen.getByTestId('pty-agent-type')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pty-spawn-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/spawn',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-new-live-806',
        agent_kind: 'claude',
        role: 'Claude 806 New',
        pty_id: 'pty-new-806',
        inner_session_id: 'claude-thread-new-806',
        source_host_id: 'runtime-host-523',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];
    rerender(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-new-806')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(ptyListFetchCount).toBeGreaterThanOrEqual(2);
    });

    delayedPtyRefresh.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-new-806')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-rightpanel-pty-disconnected')).not.toBeInTheDocument();
    });

    expect(runtimeClientMocks.updateSession.mock.calls.some(([, sessionId]) => (
      sessionId === 'session-new-live-806'
    ))).toBe(false);
  });

  it('does not auto-complete a freshly created terminal session before the PTY list catches up（新建终端会话在 /pty 列表刷新前不应被误收敛为 completed）', async () => {
    const nowIso = new Date().toISOString();
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-fresh-spawn-806',
        agent_kind: 'claude',
        role: 'Fresh Spawn 806',
        pty_id: 'pty-fresh-spawn-806',
        inner_session_id: null,
        created_at: nowIso,
        last_active_at: nowIso,
      }),
    ];

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

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pty'))).toBe(true);
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-fresh-spawn-806',
      { status: 'completed' },
    );
  });

  it('does not persist raw spawned PTY ids into tiled pane order and clears stale fullscreen recovery（spawn raw PTY 时不应污染 pane order，且应清空旧恢复快照）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: ['session-issue-806'],
      fullscreenPtyId: 'pty-stale-recovery-818',
      fullscreenTerminalRecovery: {
        sessionId: 'session-stale-recovery-818',
        sourceHostId: 'runtime-host-523',
        agentType: 'codex',
        innerSessionId: 'codex-thread-stale-recovery-818',
        role: 'Stale Recovery 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
      if (url.endsWith('/pty/spawn')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-new-806',
            name: 'Claude 806 New',
            workdir: 'D:/project/exomind',
          }),
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
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('pty-spawn-button'));
    await waitFor(() => {
      expect(screen.getByTestId('pty-agent-type')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pty-spawn-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-new-806')).toBeInTheDocument();
    });

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('exomind:agentHubTiledState') ?? '{}') as {
        paneOrder?: string[];
        fullscreenPtyId?: string;
        fullscreenTerminalRecovery?: unknown;
      };
      expect(persisted.fullscreenPtyId).toBe('pty-new-806');
      expect(persisted.paneOrder).toEqual(['session-issue-806']);
      expect(persisted.paneOrder).not.toContain('pty-new-806');
      expect(persisted.fullscreenTerminalRecovery).toBeUndefined();
    });
  });

  it('maps a spawned PTY back to its session id once the session stream catches up（spawn 后 session 流补齐时应把 pane order 回填为 session id）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: ['session-issue-806'],
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
      if (url.endsWith('/pty/spawn')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-new-806',
            name: 'Claude 806 New',
            workdir: 'D:/project/exomind',
          }),
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
            {
              id: 'pty-new-806',
              name: 'Claude 806 New',
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

    const { rerender } = render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('pty-spawn-button'));
    await waitFor(() => {
      expect(screen.getByTestId('pty-agent-type')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pty-spawn-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-new-806')).toBeInTheDocument();
    });

    sessionStreamState.sessions = [
      buildSession({}),
      buildSession({
        id: 'session-new-live-806',
        agent_kind: 'claude',
        role: 'Claude 806 New',
        pty_id: 'pty-new-806',
        inner_session_id: 'claude-thread-new-806',
        source_host_id: 'runtime-host-523',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];
    rerender(<AgentsPage />);

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('exomind:agentHubTiledState') ?? '{}') as {
        paneOrder?: string[];
      };
      expect(persisted.paneOrder).toEqual(['session-issue-806', 'session-new-live-806']);
      expect(persisted.paneOrder).not.toContain('pty-new-806');
    });
  });

  it('keeps a disconnected pending-binding terminal session active instead of auto-completing it（待补绑 inner_session_id 的失联终端应保留活跃断开态）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pendingBindingIso = new Date(Date.now() - 20_000).toISOString();
    localStorage.setItem('exomind:agentHubViewMode', 'sessions');
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-pending-binding-824',
        agent_kind: 'claude',
        role: 'Pending Binding 824',
        pty_id: 'pty-pending-binding-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
      }),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-pending-binding-824')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(infoSpy.mock.calls.some(([message, payload]) => (
        message === '[agent-hub][pty] keep disconnected terminal session active because historical binding is still pending'
        && (payload as { sessionId?: string }).sessionId === 'session-pending-binding-824'
      ))).toBe(true);
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-pending-binding-824',
      { status: 'completed' },
    );

    infoSpy.mockRestore();
  });

  it('does not keep a disconnected pending-binding session active when its workdir context is unusable（待补绑会话若无可恢复工作目录，不应继续假活跃）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pendingBindingIso = new Date(Date.now() - 20_000).toISOString();
    localStorage.setItem('exomind:agentHubViewMode', 'sessions');
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-pending-binding-invalid-workdir-824',
        agent_kind: 'claude',
        role: 'Pending Binding Invalid Workdir 824',
        pty_id: 'pty-pending-binding-invalid-workdir-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind/${workdir}',
        },
      }),
    ];

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

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        agent_kind: 'claude',
        role: 'Pending Binding Invalid Workdir 824',
        pty_id: 'pty-pending-binding-invalid-workdir-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        status: request.status ?? 'running',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind/${workdir}',
        },
      }),
    }));

    render(<AgentsPage />);

    await waitFor(() => {
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-pending-binding-invalid-workdir-824',
        { status: 'completed' },
      );
    });

    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] keep disconnected terminal session active because historical binding is still pending'
      && (payload as { sessionId?: string }).sessionId === 'session-pending-binding-invalid-workdir-824'
    ))).toBe(false);

    infoSpy.mockRestore();
  });

  it('does not keep a pending-binding session active when its stale source host cannot fall back to the current runtime（待补绑会话若 source host 已失效且不能回退当前 RT，不应继续假活跃）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pendingBindingIso = new Date(Date.now() - 20_000).toISOString();
    localStorage.setItem('exomind:agentHubViewMode', 'sessions');
    localStorage.setItem('exomind:runtimeTargetMode', 'external');
    localStorage.setItem('exomind:runtimeExternalAddress', '192.168.1.119:1919');
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-pending-binding-stale-host-824',
        agent_kind: 'claude',
        role: 'Pending Binding Stale Host 824',
        pty_id: 'pty-pending-binding-stale-host-824',
        inner_session_id: null,
        source_host_id: 'stale-runtime-host-824',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
    ];

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

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        agent_kind: 'claude',
        role: 'Pending Binding Stale Host 824',
        pty_id: 'pty-pending-binding-stale-host-824',
        inner_session_id: null,
        source_host_id: 'stale-runtime-host-824',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        status: request.status ?? 'running',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
    }));

    render(<AgentsPage />);

    await waitFor(() => {
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-pending-binding-stale-host-824',
        { status: 'completed' },
      );
    });

    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] keep disconnected terminal session active because historical binding is still pending'
      && (payload as { sessionId?: string }).sessionId === 'session-pending-binding-stale-host-824'
    ))).toBe(false);

    infoSpy.mockRestore();
  });

  it('prefers the most recent bound historical session id when pending Claude binding is ambiguous（待补绑 Claude 存在多个历史候选时应优先最近一次已绑定链路）', async () => {
    const pendingBindingIso = new Date(Date.now() - 20_000).toISOString();
    const recentBoundIso = new Date(Date.now() - 5 * 60_000).toISOString();
    const olderBoundIso = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
    localStorage.setItem('exomind:agentHubViewMode', 'sessions');
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-pending-binding-ambiguous-824',
        agent_kind: 'claude',
        role: 'Pending Binding Ambiguous 824',
        pty_id: 'pty-pending-binding-ambiguous-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
      buildSession({
        id: 'session-bound-recent-824',
        agent_kind: 'claude',
        role: 'Claude Recent 824',
        pty_id: 'pty-bound-recent-824',
        inner_session_id: 'claude-thread-recent-824',
        source_host_id: 'runtime-host-523',
        status: 'archived',
        created_at: recentBoundIso,
        last_active_at: recentBoundIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
      buildSession({
        id: 'session-bound-older-824',
        agent_kind: 'claude',
        role: 'Claude Older 824',
        pty_id: 'pty-bound-older-824',
        inner_session_id: 'claude-thread-older-824',
        source_host_id: 'runtime-host-523',
        status: 'archived',
        created_at: olderBoundIso,
        last_active_at: olderBoundIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'claude-thread-older-824',
              project_path: 'H--A137442-Develop-AGI-exomind',
              last_modified: olderBoundIso,
            },
            {
              agent_type: 'claude',
              session_id: 'claude-thread-recent-824',
              project_path: 'H--A137442-Develop-AGI-exomind',
              last_modified: recentBoundIso,
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/session-pending-binding-ambiguous-824') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'session-pending-binding-ambiguous-824',
            inner_session_id: 'claude-thread-recent-824',
          }),
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/sessions/session-pending-binding-ambiguous-824',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ inner_session_id: 'claude-thread-recent-824' }),
        }),
      );
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-pending-binding-ambiguous-824',
      { status: 'completed' },
    );
  });

  it('does not auto-complete an older pending Claude binding session when a preferred historical recovery candidate already exists（较旧的待补绑 Claude 会话若已有首选历史链路，不应被抢先收敛为 completed）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pendingBindingIso = new Date(Date.now() - 20 * 60_000).toISOString();
    const recentBoundIso = new Date(Date.now() - 5 * 60_000).toISOString();
    const olderBoundIso = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
    localStorage.setItem('exomind:agentHubViewMode', 'sessions');
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-pending-binding-older-824',
        agent_kind: 'claude',
        role: 'Pending Binding Older 824',
        pty_id: 'pty-pending-binding-older-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        created_at: pendingBindingIso,
        last_active_at: pendingBindingIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
      buildSession({
        id: 'session-bound-recent-older-824',
        agent_kind: 'claude',
        role: 'Claude Recent Older 824',
        pty_id: 'pty-bound-recent-older-824',
        inner_session_id: 'claude-thread-recent-older-824',
        source_host_id: 'runtime-host-523',
        status: 'archived',
        created_at: recentBoundIso,
        last_active_at: recentBoundIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
      buildSession({
        id: 'session-bound-older-older-824',
        agent_kind: 'claude',
        role: 'Claude Older Older 824',
        pty_id: 'pty-bound-older-older-824',
        inner_session_id: 'claude-thread-older-older-824',
        source_host_id: 'runtime-host-523',
        status: 'archived',
        created_at: olderBoundIso,
        last_active_at: olderBoundIso,
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'H:/A137442/Develop/AGI/exomind',
        },
      }),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'claude-thread-older-older-824',
              project_path: 'h--a137442-develop-agi-exomind',
              last_modified: olderBoundIso,
            },
            {
              agent_type: 'claude',
              session_id: 'claude-thread-recent-older-824',
              project_path: 'h--a137442-develop-agi-exomind',
              last_modified: recentBoundIso,
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/session-pending-binding-older-824') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'session-pending-binding-older-824',
            inner_session_id: 'claude-thread-recent-older-824',
          }),
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/sessions/session-pending-binding-older-824',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ inner_session_id: 'claude-thread-recent-older-824' }),
        }),
      );
    });

    await waitFor(() => {
      expect(infoSpy.mock.calls.some(([message, payload]) => (
        message === '[agent-hub][pty] keep disconnected terminal session active because historical binding already has a preferred recovery candidate'
        && (payload as { sessionId?: string }).sessionId === 'session-pending-binding-older-824'
      ))).toBe(true);
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-pending-binding-older-824',
      { status: 'completed' },
    );

    infoSpy.mockRestore();
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

  it('auto-resumes disconnected session cards after entering the sessions view（切到会话页后应自动恢复可恢复的断开会话卡片）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-current-824',
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-04-03T10:00:00.000Z',
      agents: [],
      hosts: [],
    });
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-sessions-view-restart-824',
        role: 'Codex Sessions View 824',
        pty_id: 'pty-sessions-view-stale-824',
        inner_session_id: 'codex-thread-sessions-view-824',
        source_host_id: 'runtime-host-stale-824',
        last_active_at: '2026-04-03T00:00:00.000Z',
      }),
    ];

    let resumePosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'codex-thread-sessions-view-824',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-03T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => (
            resumePosted
              ? [
                {
                  id: 'pty-resumed-sessions-view-824',
                  name: 'Codex Sessions View Resumed 824',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                },
              ]
              : []
          ),
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-sessions-view-824',
            name: 'Codex Sessions View Resumed 824',
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/pty'))).toBe(true);
    });

    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);

    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
      ).toHaveLength(1);
    });

    expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      'session-sessions-view-restart-824',
      { status: 'completed' },
    );
    expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      'session-sessions-view-restart-824',
      { status: 'archived' },
    );
    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] scheduling disconnected terminal auto-resume'
      && (payload as { sessionId?: string }).sessionId === 'session-sessions-view-restart-824'
    ))).toBe(true);

    infoSpy.mockRestore();
  });

  it('redirects duplicate historical session cards to the canonical PTY window（重复历史会话卡片应聚焦已有 PTY，而不是再开一扇窗）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-duplicate-817',
        role: 'Codex Duplicate',
        pty_id: 'pty-stale-817',
        source_host_id: 'stale-runtime-host-817',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:00.000Z',
      }),
      buildSession({
        id: 'session-canonical-817',
        role: 'Codex Canonical',
        pty_id: 'pty-live-806',
        source_host_id: 'runtime-host-523',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:10.000Z',
      }),
    ];

    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-duplicate-817'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);

    await waitFor(() => {
      expect(runtimeClientMocks.stopPtyAgent).toHaveBeenCalledWith(
        expect.anything(),
        'pty-stale-817',
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-duplicate-817',
        { status: 'completed' },
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-duplicate-817',
        { status: 'archived' },
      );
    });
  });

  it('treats superseded retirement conflicts as already satisfied when the session has already advanced（重复退休命中 409 时若后端已推进状态则不再误报失败）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-duplicate-817',
        role: 'Codex Duplicate',
        pty_id: 'pty-stale-817',
        source_host_id: 'stale-runtime-host-817',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:00.000Z',
      }),
      buildSession({
        id: 'session-canonical-817',
        role: 'Codex Canonical',
        pty_id: 'pty-live-806',
        source_host_id: 'runtime-host-523',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:10.000Z',
      }),
    ];

    runtimeClientMocks.updateSession
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'invalid_transition',
          message: 'HTTP 409',
          status: 409,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: buildSession({
          id: 'session-duplicate-817',
          role: 'Codex Duplicate',
          pty_id: 'pty-stale-817',
          source_host_id: 'stale-runtime-host-817',
          inner_session_id: 'codex-thread-shared-817',
          status: 'archived',
        }),
      });
    runtimeClientMocks.getSession.mockResolvedValue({
      ok: true,
      data: buildSession({
        id: 'session-duplicate-817',
        role: 'Codex Duplicate',
        pty_id: 'pty-stale-817',
        source_host_id: 'stale-runtime-host-817',
        inner_session_id: 'codex-thread-shared-817',
        status: 'completed',
      }),
    });

    render(<AgentsPage />);

    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-duplicate-817'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-806')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(runtimeClientMocks.getSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-duplicate-817',
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'session-duplicate-817',
        { status: 'completed' },
      );
      expect(runtimeClientMocks.updateSession).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'session-duplicate-817',
        { status: 'archived' },
      );
    });

    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty] superseded terminal session retirement step already satisfied after conflict'
      && (payload as { sessionId?: string }).sessionId === 'session-duplicate-817'
      && (payload as { requestedStatus?: string }).requestedStatus === 'completed'
      && (payload as { latestStatus?: string }).latestStatus === 'completed'
    ))).toBe(true);
    expect(warnSpy.mock.calls.some(([message]) => (
      message === '[agent-hub][pty] failed to retire duplicate terminal window binding'
    ))).toBe(false);

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('does not retire a freshly recovered live session just because a disconnected history panel was focused（断开历史面板占焦点时不应反向归档新恢复的 live 会话）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: 'fullscreen',
      fullscreenPtyId: 'pty-stale-focused-824',
      paneOrder: ['session-stale-focused-824'],
    }));

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-stale-focused-824',
        role: 'Focused Stale 824',
        agent_kind: 'claude',
        pty_id: 'pty-stale-focused-824',
        inner_session_id: 'claude-thread-focused-824',
        source_host_id: 'stale-runtime-host-824',
        last_active_at: '2026-04-02T00:00:00.000Z',
      }),
      buildSession({
        id: 'session-resumed-live-824',
        role: 'Recovered Live 824',
        agent_kind: 'claude',
        pty_id: 'pty-resumed-live-824',
        inner_session_id: 'claude-thread-focused-824',
        source_host_id: 'runtime-host-523',
        last_active_at: '2026-04-02T00:00:20.000Z',
      }),
    ];

    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        role: sessionId === 'session-stale-focused-824' ? 'Focused Stale 824' : 'Recovered Live 824',
        agent_kind: 'claude',
        pty_id: sessionId === 'session-stale-focused-824' ? 'pty-stale-focused-824' : 'pty-resumed-live-824',
        inner_session_id: 'claude-thread-focused-824',
        source_host_id: sessionId === 'session-stale-focused-824' ? 'stale-runtime-host-824' : 'runtime-host-523',
        status: request.status ?? 'running',
        last_active_at: sessionId === 'session-stale-focused-824'
          ? '2026-04-02T00:00:00.000Z'
          : '2026-04-02T00:00:20.000Z',
      }),
    }));

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
          json: async () => [
            {
              id: 'pty-resumed-live-824',
              name: 'Recovered Live 824',
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
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-stale-focused-824',
        { status: 'completed' },
      );
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-resumed-live-824',
      expect.anything(),
    );
  });

  it('rebinds a persisted fullscreen terminal to the current live PTY by logical session identity after RT restart（RT 重启后旧 PTY 已失效时应按持久逻辑会话重新绑定 live PTY）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: ['session-stale-focused-818'],
      fullscreenPtyId: 'pty-stale-focused-818',
      fullscreenTerminalRecovery: {
        sessionId: 'session-stale-focused-818',
        sourceHostId: 'stale-runtime-host-818',
        agentType: 'codex',
        innerSessionId: 'codex-thread-focused-818',
        role: 'Focused Persisted 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-rebound-live-818',
        role: 'Rebound Live 818',
        agent_kind: 'codex',
        pty_id: 'pty-rebound-live-818',
        inner_session_id: 'codex-thread-focused-818',
        source_host_id: 'runtime-host-523',
        last_active_at: '2026-04-04T00:00:20.000Z',
      }),
    ];

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
          json: async () => [
            {
              id: 'pty-rebound-live-818',
              name: 'Rebound Live 818',
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
      expect(screen.getByTestId('mock-pty-terminal-pty-rebound-live-818')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-rightpanel-pty-disconnected')).not.toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
    ).toHaveLength(0);
    await waitFor(() => {
      expect(localStorage.getItem('exomind:agentHubTiledState')).toContain('pty-rebound-live-818');
      expect(localStorage.getItem('exomind:agentHubTiledState')).toContain('codex-thread-focused-818');
    });
  });

  it('auto-resumes a persisted fullscreen terminal from saved recovery info even when the old session record is gone（旧 session 记录缺失时也应按持久恢复信息自动 /pty/resume）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: [],
      fullscreenPtyId: 'pty-persisted-stale-818',
      fullscreenTerminalRecovery: {
        sessionId: 'session-persisted-stale-818',
        sourceHostId: 'stale-runtime-host-818',
        agentType: 'codex',
        innerSessionId: 'codex-thread-persisted-818',
        role: 'Persisted Fullscreen 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    sessionStreamState.sessions = [];

    let resumePosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'codex-thread-persisted-818',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-04T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => (
            resumePosted
              ? [{
                  id: 'pty-resumed-from-persisted-818',
                  name: 'Persisted Fullscreen 818',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                }]
              : []
          ),
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-from-persisted-818',
            name: 'Persisted Fullscreen 818',
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

    render(<AgentsPage />);

    await waitFor(() => {
      const resumeCall = fetchMock.mock.calls.find(([input]) => String(input) === 'http://127.0.0.1:1919/pty/resume');
      expect(resumeCall).toBeDefined();
      expect(resumeCall?.[1]).toEqual(expect.objectContaining({
        method: 'POST',
      }));
      expect(JSON.parse(String((resumeCall?.[1] as RequestInit | undefined)?.body ?? '{}'))).toEqual(expect.objectContaining({
        agent_type: 'codex',
        session_id: 'codex-thread-persisted-818',
        name: 'Persisted Fullscreen 818',
        workdir: 'D:/project/exomind',
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-from-persisted-818')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-rightpanel-pty-disconnected')).not.toBeInTheDocument();
    });

    expect(localStorage.getItem('exomind:agentHubTiledState')).toContain('pty-resumed-from-persisted-818');
    expect(localStorage.getItem('exomind:agentHubTiledState')).toContain('codex-thread-persisted-818');
  });

  it('does not rebind a persisted fullscreen terminal to another live PTY from the same workdir（同目录不同 inner_session_id 的 live PTY 不能劫持持久恢复）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: [],
      fullscreenPtyId: 'pty-persisted-stale-818',
      fullscreenTerminalRecovery: {
        sessionId: 'session-persisted-stale-818',
        sourceHostId: 'stale-runtime-host-818',
        agentType: 'codex',
        innerSessionId: 'codex-thread-persisted-818',
        role: 'Persisted Fullscreen 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-live-same-workdir-818',
        role: 'Live Same Workdir 818',
        agent_kind: 'codex',
        pty_id: 'pty-live-same-workdir-818',
        inner_session_id: 'codex-thread-other-818',
        source_host_id: 'runtime-host-523',
        last_active_at: '2026-04-04T00:00:20.000Z',
      }),
    ];

    let resumePosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'codex-thread-persisted-818',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-04T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => (
            resumePosted
              ? [{
                  id: 'pty-resumed-from-persisted-818',
                  name: 'Persisted Fullscreen 818',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                }, {
                  id: 'pty-live-same-workdir-818',
                  name: 'Live Same Workdir 818',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                }]
              : [{
                  id: 'pty-live-same-workdir-818',
                  name: 'Live Same Workdir 818',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                }]
          ),
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-from-persisted-818',
            name: 'Persisted Fullscreen 818',
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

    render(<AgentsPage />);

    await waitFor(() => {
      const resumeCall = fetchMock.mock.calls.find(([input]) => String(input) === 'http://127.0.0.1:1919/pty/resume');
      expect(resumeCall).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-from-persisted-818')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-pty-terminal-pty-live-same-workdir-818')).not.toBeInTheDocument();
    });

    expect(localStorage.getItem('exomind:agentHubTiledState')).toContain('pty-resumed-from-persisted-818');
    expect(localStorage.getItem('exomind:agentHubTiledState')).not.toContain('pty-live-same-workdir-818');
  });

  it('clears a stale fullscreen recovery snapshot after opening a raw topology PTY with no recoverable session（打开无 session 绑定的拓扑 PTY 时要清除旧恢复快照）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: [],
      fullscreenTerminalRecovery: {
        sessionId: 'session-stale-focused-818',
        sourceHostId: 'stale-runtime-host-818',
        agentType: 'codex',
        innerSessionId: 'codex-thread-focused-818',
        role: 'Focused Persisted 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    sessionStreamState.sessions = [];

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
          json: async () => [
            {
              id: 'pty-raw-topology-818',
              name: 'Raw Topology 818',
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

    fireEvent.click(await screen.findByTestId('mock-react-flow-node-pty-pty-raw-topology-818'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-raw-topology-818')).toBeInTheDocument();
    });

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('exomind:agentHubTiledState') ?? '{}') as {
        fullscreenPtyId?: string;
        fullscreenTerminalRecovery?: unknown;
      };
      expect(persisted.fullscreenPtyId).toBe('pty-raw-topology-818');
      expect(persisted.fullscreenTerminalRecovery).toBeUndefined();
    });
  });

  it('shows a failure message instead of staying stuck in persisted fullscreen recovery loading when the historical lookup times out（持久恢复历史查询超时时不能一直卡在加载中）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: [],
      fullscreenPtyId: 'pty-persisted-timeout-818',
      fullscreenTerminalRecovery: {
        sessionId: 'session-persisted-timeout-818',
        sourceHostId: 'stale-runtime-host-818',
        agentType: 'codex',
        innerSessionId: 'codex-thread-timeout-818',
        role: 'Persisted Timeout 818',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    }));

    sessionStreamState.sessions = [];

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
      if (url.includes('/pty/sessions?agent_type=codex')) {
        throw new Error('request timeout（请求超时）');
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
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected-message')).toHaveTextContent(
        'Terminal 已断开，自动恢复失败',
      );
      expect(screen.getByTestId('mock-pty-terminal-pty-persisted-timeout-818')).toBeInTheDocument();
    });
  });

  it('auto-resumes only one canonical PTY per historical inner session id after RT restart（同一历史会话在 RT 重启后只自动恢复一次）', async () => {
    localStorage.setItem('exomind:agentHubTiledState', JSON.stringify({
      layout: '2x2',
      paneOrder: ['session-duplicate-817'],
    }));

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-duplicate-817',
        role: 'Codex Duplicate',
        pty_id: 'pty-stale-817',
        source_host_id: 'stale-runtime-host-817',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:00.000Z',
      }),
      buildSession({
        id: 'session-canonical-817',
        role: 'Codex Canonical',
        pty_id: 'pty-canonical-stale-817',
        source_host_id: 'stale-runtime-host-817',
        inner_session_id: 'codex-thread-shared-817',
        last_active_at: '2026-04-02T00:00:10.000Z',
      }),
    ];

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
              session_id: 'codex-thread-shared-817',
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
          json: async () => (
            resumePosted
              ? [{
                  id: 'pty-resumed-817',
                  name: 'Codex Canonical Resumed',
                  status: 'running',
                  workdir: 'D:/project/exomind',
                }]
              : []
          ),
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        resumePosted = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-817',
            name: 'Codex Canonical Resumed',
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume')),
      ).toHaveLength(1);
    });

    const resumeCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/pty/resume'));
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0]).toEqual([
      'http://127.0.0.1:1919/pty/resume',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"session_id":"codex-thread-shared-817"'),
      }),
    ]);
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

  it('shows a disconnected failure state instead of hanging when opening a stale session card（点击 stale 活跃卡片后应明确显示失败信息）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-stale-open-824',
        role: 'Stale Open 824',
        pty_id: 'pty-stale-open-824',
        inner_session_id: null,
        source_host_id: 'stale-runtime-host-824',
      }),
    ];

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
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-stale-open-824'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('agent-runtime-error-banner')).toHaveTextContent(
        'Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。',
      );
      expect(screen.getByTestId('agent-rightpanel-pty-disconnected-message')).toHaveTextContent(
        'Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。',
      );
    });

    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][open] session PTY is disconnected'
      && (payload as { sessionId?: string }).sessionId === 'session-stale-open-824'
    ))).toBe(true);
    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][open] disconnected terminal history panel opened'
      && (payload as { sessionId?: string }).sessionId === 'session-stale-open-824'
    ))).toBe(true);

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('falls back to the current embedded runtime when a stale local source host is still discoverable（旧 local source host 仍可见时也应按当前 embedded RT 判定并恢复）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-current-824',
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-04-03T10:00:00.000Z',
      agents: [],
      hosts: [
        buildSnapshot({
          host: {
            id: 'stale-local-host-record',
            name: '192.168.1.119:1919',
            host: '192.168.1.119',
            port: 1919,
            isLocal: true,
          },
          topology: {
            host_id: 'stale-local-runtime-host-824',
            hostname: 'stale-local-runtime-host-824',
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
        }),
        buildSnapshot({
          host: {
            id: 'current-local-host-record',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            isLocal: true,
          },
          topology: {
            host_id: 'runtime-host-current-824',
            hostname: 'runtime-host-current-824',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 30,
            version: '0.3.6',
            port: 1919,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli', 'api'],
              api_providers: ['openai', 'anthropic'],
            },
          },
        }),
      ],
    });
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-local-stale-824',
        role: 'Local Stale 824',
        agent_kind: 'claude',
        pty_id: 'pty-local-stale-824',
        inner_session_id: 'claude-thread-local-stale-824',
        source_host_id: 'stale-local-runtime-host-824',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];

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
      if (url.includes('/pty/sessions?agent_type=claude')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'claude',
              session_id: 'claude-thread-local-stale-824',
              project_path: 'D--project-exomind',
              last_modified: '2026-04-03T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-fallback-824',
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

    render(<AgentsPage />);
    await waitFor(() => {
      expect(runtimeControlMocks.getStatus).toHaveBeenCalled();
      expect(runtimeManagerMocks.refreshSnapshot).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty',
        expect.anything(),
      );
    });
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-local-stale-824'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            agent_type: 'claude',
            session_id: 'claude-thread-local-stale-824',
            name: 'Local Stale 824',
            workdir: 'D:/project/exomind',
          }),
        }),
      );
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://192.168.1.119:1919/pty/resume',
      expect.anything(),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-fallback-824')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-rightpanel-pty-disconnected')).not.toBeInTheDocument();
    });

    expect(warnSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][open] session PTY is disconnected'
      && (payload as { sessionId?: string }).sessionId === 'session-local-stale-824'
    ))).toBe(true);
    expect(infoSpy.mock.calls.some(([message, payload]) => (
      message === '[agent-hub][pty][open] resumed disconnected terminal session'
      && (payload as { sessionId?: string }).sessionId === 'session-local-stale-824'
    ))).toBe(true);

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('falls back to the current embedded runtime when a stale remote-looking source host still points at the embedded session（旧 host 以远端形态残留时也应按当前 embedded RT 恢复）', async () => {
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1919,
      hostId: 'runtime-host-current-remote-fallback-824',
    });
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-04-04T10:00:00.000Z',
      agents: [],
      hosts: [
        buildSnapshot({
          host: {
            id: 'stale-remote-host-record',
            name: '192.168.1.119:1919',
            host: '192.168.1.119',
            port: 1919,
            isLocal: false,
          },
          topology: {
            host_id: 'stale-remote-runtime-host-824',
            hostname: 'stale-remote-runtime-host-824',
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
        }),
      ],
    });
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-remote-alias-824',
        role: 'Remote Alias 824',
        agent_kind: 'codex',
        pty_id: 'pty-remote-alias-824',
        inner_session_id: 'codex-thread-remote-alias-824',
        source_host_id: 'stale-remote-runtime-host-824',
        source_host_address: '127.0.0.1:1919',
        source_host_name: '127.0.0.1:1919',
        context: {
          issue_refs: [],
          labels: [],
          work_dir: 'D:/project/exomind',
        },
      }),
    ];

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
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-remote-alias-824',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-04T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url === 'http://192.168.1.119:1919/pty/resume') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized' }),
        } as Response;
      }
      if (url.endsWith('/pty/resume')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pty-resumed-remote-alias-824',
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

    render(<AgentsPage />);
    fireEvent.click(await screen.findByTestId('agent-view-toggle-sessions'));
    fireEvent.click(await screen.findByTestId('session-card-session-remote-alias-824'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            agent_type: 'codex',
            session_id: 'codex-thread-remote-alias-824',
            name: 'Remote Alias 824',
            workdir: 'D:/project/exomind',
          }),
        }),
      );
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://192.168.1.119:1919/pty/resume',
      expect.anything(),
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-resumed-remote-alias-824')).toBeInTheDocument();
    });
  });

  it('does not retire a fresh live session in favor of a disconnected historical duplicate（不会让断开的旧会话反向归档新 live 会话）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-old-disconnected-824',
        role: 'Old Disconnected 824',
        pty_id: 'pty-old-disconnected-824',
        inner_session_id: 'codex-thread-shared-824',
        source_host_id: 'stale-runtime-host-824',
        last_active_at: '2026-04-03T00:00:00.000Z',
      }),
      buildSession({
        id: 'session-new-live-824',
        role: 'New Live 824',
        pty_id: 'pty-new-live-824',
        inner_session_id: 'codex-thread-shared-824',
        source_host_id: 'runtime-host-523',
        last_active_at: '2026-04-03T00:05:00.000Z',
      }),
    ];
    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        pty_id: sessionId === 'session-old-disconnected-824'
          ? 'pty-old-disconnected-824'
          : 'pty-new-live-824',
        inner_session_id: 'codex-thread-shared-824',
        source_host_id: sessionId === 'session-old-disconnected-824'
          ? 'stale-runtime-host-824'
          : 'runtime-host-523',
        status: request.status ?? 'running',
      }),
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'codex-thread-shared-824',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-03T00:05:00.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'pty-new-live-824',
              name: 'New Live 824',
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
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.anything(),
        'session-old-disconnected-824',
        { status: 'completed' },
      );
    });

    expect(runtimeClientMocks.updateSession.mock.calls.some(([, sessionId]) => (
      sessionId === 'session-new-live-824'
    ))).toBe(false);
  });

  it('auto-resumes once the embedded runtime host settling window expires（RT 重启后的 settling 窗口到期后应继续自动恢复）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-04T07:00:00.000Z'));
      localStorage.setItem('exomind:agentHubViewMode', 'sessions');
      sessionStreamState.sessions = [
        buildSession({
          id: 'session-settling-expiry-806',
          role: 'Settling Expiry 806',
          pty_id: 'pty-settling-expiry-806',
          inner_session_id: 'codex-thread-settling-expiry-806',
          source_host_id: 'stale-runtime-host-806',
        }),
      ];
      runtimeControlMocks.getStatus.mockResolvedValue({
        running: true,
        host: '127.0.0.1',
        port: 1919,
        hostId: 'runtime-host-current-806',
        startedAt: '2026-04-04T07:00:00.000Z',
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
        if (url.includes('/pty/sessions?agent_type=codex')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                agent_type: 'codex',
                session_id: 'codex-thread-settling-expiry-806',
                project_path: 'D:/project/exomind',
                last_modified: '2026-04-04T07:00:05.000Z',
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
        if (url.endsWith('/pty/resume')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 'pty-resumed-after-settling-806',
              name: 'Settling Expiry 806 Resumed',
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

      render(<AgentsPage />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/pty/resume'))).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_100);
      });

      const resumeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/pty/resume'));
      expect(resumeCall).toBeDefined();
      expect(resumeCall?.[0]).toBe('http://127.0.0.1:1919/pty/resume');
      expect(resumeCall?.[1]).toEqual(expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          agent_type: 'codex',
          session_id: 'codex-thread-settling-expiry-806',
          name: 'Settling Expiry 806',
          workdir: 'D:/project/exomind',
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-completes disconnected non-recoverable terminal sessions（已确认不可恢复的失联终端会话会自动收敛为 completed）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-auto-complete-824',
        role: 'Auto Complete 824',
        pty_id: 'pty-auto-complete-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
      }),
    ];
    runtimeClientMocks.updateSession.mockImplementation(async (
      _host: unknown,
      sessionId: string,
      request: { status?: SessionInfo['status'] },
    ) => ({
      ok: true,
      data: buildSession({
        id: sessionId,
        role: 'Auto Complete 824',
        pty_id: 'pty-auto-complete-824',
        inner_session_id: null,
        source_host_id: 'runtime-host-523',
        status: request.status ?? 'running',
      }),
    }));

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
      expect(runtimeClientMocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 1919 }),
        'session-auto-complete-824',
        { status: 'completed' },
      );
    });
  });

  it('keeps recoverable disconnected sessions active when historical records still exist（仍可恢复的失联会话不应被自动收敛）', async () => {
    sessionStreamState.sessions = [
      buildSession({
        id: 'session-recoverable-824',
        role: 'Recoverable 824',
        pty_id: 'pty-recoverable-824',
        inner_session_id: 'codex-thread-824',
        source_host_id: 'stale-runtime-host-824',
      }),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes') || url.includes('/signals/history')) {
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
              session_id: 'codex-thread-824',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-03T00:00:05.000Z',
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/sessions?agent_type=codex',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    expect(runtimeClientMocks.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      'session-recoverable-824',
      { status: 'completed' },
    );
  });
});
