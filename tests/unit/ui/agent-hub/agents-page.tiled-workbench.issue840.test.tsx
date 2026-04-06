import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SessionInfo } from '@/lib/types/session';
import { AGENTS_VIEW_PERSISTENCE_STORAGE_KEY } from '@/ui/app/pages/agents/agents-view-persistence';
import { writeAgentsTiledPersistState } from '@/ui/app/pages/agents/agents-tiled-persistence';
import {
  createTemplatePaneSlotBindings,
  createTemplatePaneTree,
} from '@/ui/app/pages/agents/tiled-pane-tree';

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
  updateSession: vi.fn(),
  submitQuickAction: vi.fn(),
  markSessionWaiting: vi.fn(),
}));

const sessionStreamState = vi.hoisted(() => ({
  sessions: [] as SessionInfo[],
  refresh: vi.fn(),
}));

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
  }: {
    ptyId: string;
  }) => (
    <div data-testid={`mock-pty-terminal-${ptyId}`}>
      PTY:{ptyId}
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

class MockEventSource {
  constructor(_url: string) {}

  addEventListener() {}

  removeEventListener() {}

  close() {}
}

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-840-default',
    agent_kind: 'codex',
    role: 'Workbench Session 840',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-840-default',
    inner_session_id: 'codex-thread-840',
    source_host_id: 'runtime-host-523',
    context: {
      issue_refs: [],
      labels: [],
      work_dir: 'D:/project/exomind',
    },
    created_at: '2026-04-06T00:00:00.000Z',
    last_active_at: '2026-04-06T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

function buildRuntimeSnapshot() {
  return {
    updatedAt: '2026-04-06T10:00:00.000Z',
    agents: [],
    hosts: [
      {
        host: {
          id: 'host-523',
          name: '127.0.0.1:1919',
          host: '127.0.0.1',
          port: 1919,
          status: 'unknown' as const,
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
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

describe('agents page issue-840（平铺工作台键盘快捷键）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(AGENTS_VIEW_PERSISTENCE_STORAGE_KEY, 'tiled');
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    sessionStreamState.sessions = [];

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
      yield { messageId: 'fallback-840', delta: 'fallback', done: true };
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
    runtimeClientMocks.createAgent.mockResolvedValue({ ok: true, data: { id: 'agent-840' } });
    runtimeClientMocks.deleteAgent.mockResolvedValue({ ok: true, data: { status: 'stopped', id: 'agent-840' } });
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-live-840',
        name: 'Workbench Session 840',
        session_id: null,
        workdir: 'D:/project/exomind',
        command: 'codex',
        status: 'running',
        created_at: '2026-04-06T00:00:00.000Z',
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
  });

  it('splits the focused slot from keyboard shortcuts（快捷键可分割当前焦点窗格）', async () => {
    const liveSession = buildSession({
      id: 'session-live-840',
      role: 'Live Session 840',
      pty_id: 'pty-live-840',
    });

    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: [liveSession.id],
      tree: createTemplatePaneTree('1x1'),
      slots: createTemplatePaneSlotBindings('1x1', [liveSession.id]),
      focusedSlotId: 'slot-1',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
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
          json: async () => [{
            id: liveSession.pty_id,
            name: liveSession.role,
            status: liveSession.status,
            workdir: liveSession.context?.work_dir ?? 'D:/project/exomind',
          }],
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
      expect(screen.getByTestId('tiled-slot-slot-1')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, {
      key: 'V',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId('tiled-slot-slot-2')).toBeInTheDocument();
    });
  });

  it('passes the next shortcut through to the focused PTY without mutating layout（透传下一键不会改动布局）', async () => {
    const liveSession = buildSession({
      id: 'session-live-840',
      role: 'Live Session 840',
      pty_id: 'pty-live-840',
    });

    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: [liveSession.id],
      tree: createTemplatePaneTree('1x1'),
      slots: createTemplatePaneSlotBindings('1x1', [liveSession.id]),
      focusedSlotId: 'slot-1',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
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
          json: async () => [{
            id: liveSession.pty_id,
            name: liveSession.role,
            status: liveSession.status,
            workdir: liveSession.context?.work_dir ?? 'D:/project/exomind',
          }],
        } as Response;
      }
      if (url.includes('/pty/sessions?agent_type=')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }
      if (url.includes(`/pty/${encodeURIComponent(liveSession.pty_id ?? '')}/input`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
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
      expect(screen.getByTestId('tiled-slot-slot-1')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, {
      key: 'P',
      altKey: true,
      shiftKey: true,
    });

    expect(screen.getByTestId('agents-tiled-passthrough-armed')).toBeInTheDocument();

    fireEvent.keyDown(document, {
      key: 'V',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/pty/${encodeURIComponent(liveSession.pty_id ?? '')}/input`),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
    expect(screen.queryByTestId('tiled-slot-slot-2')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('agents-tiled-passthrough-armed')).not.toBeInTheDocument();
    });
  });
});
