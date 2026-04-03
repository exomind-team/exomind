import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  stopPtyAgent: vi.fn(),
  submitQuickAction: vi.fn(),
  markSessionWaiting: vi.fn(),
}));

const sessionStreamState = vi.hoisted(() => ({
  sessions: [] as SessionInfo[],
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, children, onNodeClick }: { nodes?: Array<{ id: string; data?: { label?: string } }>; children?: unknown; onNodeClick?: (event: unknown, node: { id: string }) => void; }) => (
    <div data-testid="mock-react-flow">
      {(nodes ?? []).map((node) => (
        <button key={node.id} type="button" data-testid={`mock-react-flow-node-${node.id}`} onClick={() => onNodeClick?.({}, node)}>
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
    stopPtyAgent = runtimeClientMocks.stopPtyAgent;
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
    id: 'session-789',
    agent_kind: 'claude',
    role: 'Session 789',
    summary: '',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-03-31T00:00:00.000Z',
    last_active_at: '2026-03-31T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

function buildRuntimeSnapshot() {
  return {
    updatedAt: '2026-03-31T10:00:00.000Z',
    agents: [],
    hosts: [
      {
        host: {
          id: 'host-789',
          name: '127.0.0.1:1919',
          host: '127.0.0.1',
          port: 1919,
          status: 'unknown' as const,
          createdAt: '2026-03-31T00:00:00.000Z',
          updatedAt: '2026-03-31T00:00:00.000Z',
        },
        connectionState: 'online' as const,
        agents: [],
        topology: {
          host_id: 'runtime-host-789',
          hostname: 'runtime-host-789',
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

describe('agents page focusSession handoff issue-789（Agent Hub 消费 workbench focusSession）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/agents?workbenchBypass=true&focusSession=session-terminal');
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

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
    runtimeClientMocks.createAgent.mockResolvedValue({
      ok: true,
      data: { id: 'agent-789' },
    });
    runtimeClientMocks.deleteAgent.mockResolvedValue({
      ok: true,
      data: { status: 'stopped', id: 'agent-789' },
    });
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-789',
        name: 'Terminal Agent',
        session_id: null,
        workdir: 'D:/project/exomind',
        command: 'claude',
        status: 'stopped',
        created_at: '2026-03-31T00:00:00.000Z',
      },
    });
    runtimeClientMocks.submitQuickAction.mockResolvedValue({
      ok: true,
      data: buildSession({ id: 'session-quick' }),
    });
    runtimeClientMocks.markSessionWaiting.mockResolvedValue({
      ok: true,
      data: buildSession({ id: 'session-waiting', status: 'waiting_input' }),
    });

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-terminal',
        role: 'Terminal Session',
        summary: 'Running shell',
        interaction_mode: 'terminal',
        pty_id: 'pty-789',
        source_host_id: 'host-789',
      }),
    ];
  });

  it('opens the PTY terminal panel from focusSession query（通过 focusSession 自动打开 PTY 面板）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      const shell = screen.getByTestId('agent-rightpanel-shell');
      expect(shell).toBeInTheDocument();
      expect(within(shell).getByTestId('agent-rightpanel-pty-terminal')).toBeInTheDocument();
      expect(within(shell).getByTestId('agent-rightpanel-stop-pty')).toBeInTheDocument();
    });
  });
});
