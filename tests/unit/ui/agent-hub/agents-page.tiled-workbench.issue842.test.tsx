import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SessionInfo } from '@/lib/types/session';
import {
  writeAgentsTiledPersistState,
} from '@/ui/app/pages/agents/agents-tiled-persistence';
import { AGENTS_VIEW_PERSISTENCE_STORAGE_KEY } from '@/ui/app/pages/agents/agents-view-persistence';
import {
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

const ptyInputMocks = vi.hoisted(() => ({
  sendPtyShortcutInput: vi.fn(),
}));

vi.mock('@/ui/app/components/pty-input', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/app/components/pty-input')>();
  return {
    ...actual,
    sendPtyShortcutInput: ptyInputMocks.sendPtyShortcutInput,
  };
});

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
    id: 'session-842-default',
    agent_kind: 'codex',
    role: 'Workbench Session 842',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-842-default',
    inner_session_id: 'codex-thread-842',
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

function dragFromSourceToTarget(source: HTMLElement, target: HTMLElement) {
  fireEvent.pointerDown(source, {
    pointerId: 21,
    pointerType: 'mouse',
    clientX: 120,
    clientY: 80,
    isPrimary: true,
    button: 0,
  });

  fireEvent.pointerMove(window, {
    pointerId: 21,
    pointerType: 'mouse',
    clientX: 146,
    clientY: 108,
    isPrimary: true,
    buttons: 1,
  });

  fireEvent.pointerMove(target, {
    pointerId: 21,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
    buttons: 1,
  });

  fireEvent.pointerUp(target, {
    pointerId: 21,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
  });
}

describe('agents page issue-842（平铺窗格树工作台骨架）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ptyInputMocks.sendPtyShortcutInput.mockResolvedValue(true);
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
      yield { messageId: 'fallback-842', delta: 'fallback', done: true };
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
    runtimeClientMocks.createAgent.mockResolvedValue({ ok: true, data: { id: 'agent-842' } });
    runtimeClientMocks.deleteAgent.mockResolvedValue({ ok: true, data: { status: 'stopped', id: 'agent-842' } });
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-live-842',
        name: 'Workbench Session 842',
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
          json: async () => sessionStreamState.sessions
            .filter((session) => session.interaction_mode === 'terminal' && session.pty_id)
            .map((session) => ({
              id: session.pty_id,
              name: session.role,
              status: session.status,
              workdir: session.context?.work_dir ?? 'D:/project/exomind',
            })),
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
  });

  it('closing the last tiled slot leaves a true empty slot and returns the live session to the unassigned pool（关闭最后一个窗格时应回到空窗格并把会话回池）', async () => {
    const liveSession = buildSession({
      id: 'session-live-842',
      role: 'Live Session 842',
      pty_id: 'pty-live-842',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: ['session-live-842'],
      tree: createTemplatePaneTree('1x1'),
      slots: [{
        slotId: 'slot-1',
        sessionId: 'session-live-842',
        terminalRecovery: {
          sessionId: 'session-live-842',
          sourceHostId: 'runtime-host-523',
          agentType: 'codex',
          innerSessionId: 'codex-thread-842',
          role: 'Live Session 842',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      }],
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-842')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('关闭窗格'));

    await waitFor(() => {
      const slot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(slot).getByText('空窗格')).toBeInTheDocument();
      expect(within(slot).getByRole('button', { name: '绑定 Live Session 842' })).toBeInTheDocument();
      expect(within(slot).queryByText('可恢复终端')).not.toBeInTheDocument();
    });
  });

  it('auto-rebinds a recoverable slot to the canonical live session instead of leaving a stale placeholder（可恢复槽位遇到当前 live 会话时应自动重绑）', async () => {
    const liveSession = buildSession({
      id: 'session-live-842',
      role: 'Recovered Live 842',
      pty_id: 'pty-live-842',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: ['session-stale-842'],
      tree: createTemplatePaneTree('1x1'),
      slots: [{
        slotId: 'slot-1',
        sessionId: 'session-stale-842',
        terminalRecovery: {
          sessionId: 'session-stale-842',
          sourceHostId: 'runtime-host-523',
          agentType: 'codex',
          innerSessionId: 'codex-thread-842',
          role: 'Recovered Live 842',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      }],
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-842')).toBeInTheDocument();
    });

    const slot = screen.getByTestId('tiled-slot-slot-1');
    expect(slot).toHaveAttribute('data-session-id', 'session-live-842');
    expect(slot).toHaveAttribute('data-pty-id', 'pty-live-842');
    expect(within(slot).queryByText('可恢复终端')).not.toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
  });

  it('shows bind actions for every still-live terminal in empty tiled slots, including non-recoverable sessions（空窗格应能绑定所有仍活跃的终端，包括不可恢复会话）', async () => {
    const codexSession = buildSession({
      id: 'session-codex-897',
      role: 'Codex Session 897',
      pty_id: 'pty-codex-897',
      inner_session_id: 'codex-thread-897',
      agent_kind: 'codex',
    });
    const claudeSession = buildSession({
      id: 'session-claude-897',
      role: 'Claude Session 897',
      pty_id: 'pty-claude-897',
      inner_session_id: 'claude-thread-897',
      agent_kind: 'claude',
    });
    const apiTerminalSession = buildSession({
      id: 'session-api-897',
      role: 'API Session 897',
      pty_id: 'pty-api-897',
      inner_session_id: undefined,
      agent_kind: 'api',
    });
    sessionStreamState.sessions = [
      codexSession,
      claudeSession,
      apiTerminalSession,
    ];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '2x2',
      paneOrder: ['session-codex-897', 'session-claude-897'],
      tree: createTemplatePaneTree('2x2'),
      slots: [
        {
          slotId: 'slot-1',
          sessionId: 'session-codex-897',
        },
        {
          slotId: 'slot-2',
          sessionId: 'session-claude-897',
        },
        {
          slotId: 'slot-3',
        },
        {
          slotId: 'slot-4',
        },
      ],
      focusedSlotId: 'slot-3',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tiled-slot-slot-3')).toBeInTheDocument();
    });

    const slot = screen.getByTestId('tiled-slot-slot-3');
    expect(
      within(slot).getByTestId('tiled-slot-bind-slot-3-session-api-897'),
    ).toBeInTheDocument();
    expect(within(slot).getByText('绑定 API Session 897')).toBeInTheDocument();
  });

  it('moves a live tiled session into an empty slot without returning it to the unassigned pool（拖到空窗格应移动绑定而不是回池）', async () => {
    const liveSession = buildSession({
      id: 'session-live-871-move',
      role: 'Move Session 871',
      pty_id: 'pty-live-871-move',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x2',
      paneOrder: [liveSession.id],
      tree: createTemplatePaneTree('1x2'),
      slots: [
        {
          slotId: 'slot-1',
          sessionId: liveSession.id,
          terminalRecovery: {
            sessionId: liveSession.id,
            sourceHostId: 'runtime-host-523',
            agentType: 'codex',
            innerSessionId: 'codex-thread-871-move',
            role: 'Move Session 871',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
        {
          slotId: 'slot-2',
        },
      ],
      focusedSlotId: 'slot-1',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-871-move')).toBeInTheDocument();
      expect(screen.getByTestId('tiled-slot-slot-2')).toBeInTheDocument();
    });

    dragFromSourceToTarget(
      screen.getByTestId('tiled-slot-header-slot-1'),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      const sourceSlot = screen.getByTestId('tiled-slot-slot-1');
      const targetSlot = screen.getByTestId('tiled-slot-slot-2');

      expect(within(targetSlot).getByTestId('mock-pty-terminal-pty-live-871-move')).toBeInTheDocument();
      expect(within(sourceSlot).getByText('空窗格')).toBeInTheDocument();
      expect(within(sourceSlot).queryByRole('button', { name: '绑定 Move Session 871' })).not.toBeInTheDocument();
    });
  });

  it('swaps two occupied tiled slots when dragging onto another live session（拖到已占用窗格应换位）', async () => {
    const sessionA = buildSession({
      id: 'session-live-871-a',
      role: 'Swap Session A',
      pty_id: 'pty-live-871-a',
      inner_session_id: 'codex-thread-871-a',
    });
    const sessionB = buildSession({
      id: 'session-live-871-b',
      role: 'Swap Session B',
      pty_id: 'pty-live-871-b',
      inner_session_id: 'codex-thread-871-b',
    });
    sessionStreamState.sessions = [sessionA, sessionB];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x2',
      paneOrder: [sessionA.id, sessionB.id],
      tree: createTemplatePaneTree('1x2'),
      slots: [
        {
          slotId: 'slot-1',
          sessionId: sessionA.id,
          terminalRecovery: {
            sessionId: sessionA.id,
            sourceHostId: 'runtime-host-523',
            agentType: 'codex',
            innerSessionId: 'codex-thread-871-a',
            role: 'Swap Session A',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
        {
          slotId: 'slot-2',
          sessionId: sessionB.id,
          terminalRecovery: {
            sessionId: sessionB.id,
            sourceHostId: 'runtime-host-523',
            agentType: 'codex',
            innerSessionId: 'codex-thread-871-b',
            role: 'Swap Session B',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
      ],
      focusedSlotId: 'slot-1',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-871-a')).toBeInTheDocument();
      expect(screen.getByTestId('mock-pty-terminal-pty-live-871-b')).toBeInTheDocument();
    });

    dragFromSourceToTarget(
      screen.getByTestId('tiled-slot-header-slot-1'),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      const slot1 = screen.getByTestId('tiled-slot-slot-1');
      const slot2 = screen.getByTestId('tiled-slot-slot-2');

      expect(slot1).toHaveAttribute('data-session-id', sessionB.id);
      expect(slot2).toHaveAttribute('data-session-id', sessionA.id);
      expect(within(slot1).getByTestId('mock-pty-terminal-pty-live-871-b')).toBeInTheDocument();
      expect(within(slot2).getByTestId('mock-pty-terminal-pty-live-871-a')).toBeInTheDocument();
    });
  });

  it('moves a recoverable tiled pane into a live slot by swapping the full binding payload（可恢复终端拖到已占用窗格时应整体换位）', async () => {
    const liveSession = buildSession({
      id: 'session-live-871-recoverable',
      role: 'Live Session Recoverable',
      pty_id: 'pty-live-871-recoverable',
      inner_session_id: 'codex-thread-871-recoverable',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x2',
      paneOrder: [liveSession.id],
      tree: createTemplatePaneTree('1x2'),
      slots: [
        {
          slotId: 'slot-1',
          sessionId: liveSession.id,
          terminalRecovery: {
            sessionId: liveSession.id,
            sourceHostId: 'runtime-host-523',
            agentType: 'codex',
            innerSessionId: 'codex-thread-871-recoverable',
            role: 'Live Session Recoverable',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
        {
          slotId: 'slot-2',
          terminalRecovery: {
            sessionId: 'recoverable-only-session',
            sourceHostId: 'runtime-host-999',
            agentType: 'claude',
            innerSessionId: 'claude-thread-871-recoverable-only',
            role: 'Recoverable Only Slot',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
      ],
      focusedSlotId: 'slot-2',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-871-recoverable')).toBeInTheDocument();
      expect(within(screen.getByTestId('tiled-slot-header-slot-2')).getByText('可恢复终端')).toBeInTheDocument();
    });

    dragFromSourceToTarget(
      screen.getByTestId('tiled-slot-header-slot-2'),
      screen.getByTestId('tiled-slot-slot-1'),
    );

    await waitFor(() => {
      const slot1 = screen.getByTestId('tiled-slot-slot-1');
      const slot2 = screen.getByTestId('tiled-slot-slot-2');

      expect(within(screen.getByTestId('tiled-slot-header-slot-1')).getByText('可恢复终端')).toBeInTheDocument();
      expect(slot1).not.toHaveAttribute('data-session-id', liveSession.id);
      expect(slot2).toHaveAttribute('data-session-id', liveSession.id);
      expect(within(slot2).getByTestId('mock-pty-terminal-pty-live-871-recoverable')).toBeInTheDocument();
    });
  });

  it('splits the focused tiled slot from keyboard shortcuts（键盘快捷键可直接分割当前聚焦窗格）', async () => {
    const liveSession = buildSession({
      id: 'session-live-840',
      role: 'Live Session 840',
      pty_id: 'pty-live-840',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: ['session-live-840'],
      tree: createTemplatePaneTree('1x1'),
      slots: [{
        slotId: 'slot-1',
        sessionId: 'session-live-840',
        terminalRecovery: {
          sessionId: 'session-live-840',
          sourceHostId: 'runtime-host-523',
          agentType: 'codex',
          innerSessionId: 'codex-thread-842',
          role: 'Live Session 840',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      }],
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

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
      const slot = screen.getByTestId('tiled-slot-slot-2');
      expect(within(slot).getByText('空窗格')).toBeInTheDocument();
    });
  });

  it('arms passthrough and forwards the next shortcut into the focused PTY（单次透传会把下一次快捷键送入当前 PTY）', async () => {
    const liveSession = buildSession({
      id: 'session-live-840-pass',
      role: 'Passthrough Session 840',
      pty_id: 'pty-live-840-pass',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: ['session-live-840-pass'],
      tree: createTemplatePaneTree('1x1'),
      slots: [{
        slotId: 'slot-1',
        sessionId: 'session-live-840-pass',
        terminalRecovery: {
          sessionId: 'session-live-840-pass',
          sourceHostId: 'runtime-host-523',
          agentType: 'codex',
          innerSessionId: 'codex-thread-842',
          role: 'Passthrough Session 840',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      }],
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tiled-slot-slot-1')).toBeInTheDocument();
    });

    const fetchMock = vi.mocked(fetch);

    fireEvent.keyDown(document, {
      key: 'P',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId('agents-tiled-passthrough-armed')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, {
      key: 'V',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(ptyInputMocks.sendPtyShortcutInput).toHaveBeenCalledWith(
        expect.objectContaining({
          ptyId: 'pty-live-840-pass',
        }),
        'Alt+Shift+V',
      );
    });

    expect(screen.queryByTestId('tiled-slot-slot-2')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('agents-tiled-passthrough-armed')).not.toBeInTheDocument();
    });
  });

  it('immersive mode hides the global header but keeps the tiled status bar（沉浸模式隐藏全局顶栏但保留会话状态栏）', async () => {
    const liveSession = buildSession({
      id: 'session-live-856',
      role: 'Immersive Session 856',
      pty_id: 'pty-live-856',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledPersistState({
      version: 2,
      layout: '1x1',
      paneOrder: [liveSession.id],
      tree: createTemplatePaneTree('1x1'),
      slots: [{
        slotId: 'slot-1',
        sessionId: liveSession.id,
        terminalRecovery: {
          sessionId: liveSession.id,
          sourceHostId: 'runtime-host-523',
          agentType: 'codex',
          innerSessionId: 'codex-thread-856',
          role: 'Immersive Session 856',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      }],
      focusedSlotId: 'slot-1',
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByText('1 个会话')).toBeInTheDocument();
      expect(screen.getByTestId('pty-spawn-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '沉浸' }));

    await waitFor(() => {
      expect(screen.queryByText('信号网络')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pty-spawn-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-add-node-button')).not.toBeInTheDocument();
      expect(screen.getByText('1 个会话')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '退出沉浸' })).toBeInTheDocument();
    });
  });
});
