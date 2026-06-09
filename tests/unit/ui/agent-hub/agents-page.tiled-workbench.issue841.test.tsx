import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SessionInfo } from '@/lib/types/session';
import {
  DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
  readAgentsTiledWorkbenchPersistState,
  writeAgentsTiledPersistState,
  writeAgentsTiledWorkbenchPersistState,
} from '@/ui/app/pages/agents/agents-tiled-persistence';
import { AGENTS_VIEW_PERSISTENCE_STORAGE_KEY } from '@/ui/app/pages/agents/agents-view-persistence';
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

const ptySpawnDialogState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'start-only',
  nextSpawnedInfo: {
    id: 'pty-855-spawned',
    name: 'Spawned Session 855',
    session_id: null,
    workdir: 'D:/project/exomind',
    command: 'codex',
    status: 'running',
    created_at: '2026-04-06T00:00:00.000Z',
  },
  lastOnSpawnError: null as null | ((message: string) => void),
}));

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({ ptyId }: { ptyId: string }) => (
    <div data-testid={`mock-pty-terminal-${ptyId}`}>
      PTY:{ptyId}
    </div>
  ),
}));

vi.mock('@/ui/app/components/PtySpawnDialog', () => ({
  PtySpawnDialog: ({
    open,
    onOpenChange,
    onSpawned,
    onSpawnStart,
    onSpawnError,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSpawned: (info: typeof ptySpawnDialogState.nextSpawnedInfo) => void;
    onSpawnStart?: () => void;
    onSpawnError?: (message: string) => void;
  }) => (
    open ? (
      <div data-testid="mock-pty-spawn-dialog">
        <button
          type="button"
          data-testid="mock-pty-spawn-dialog-confirm"
          onClick={() => {
            ptySpawnDialogState.lastOnSpawnError = onSpawnError ?? null;
            if (onSpawnStart) {
              onSpawnStart();
              onOpenChange(false);
              if (ptySpawnDialogState.mode === 'success') {
                onSpawned(ptySpawnDialogState.nextSpawnedInfo);
              }
              return;
            }
            onSpawned(ptySpawnDialogState.nextSpawnedInfo);
            onOpenChange(false);
          }}
        >
          Spawn mocked PTY
        </button>
      </div>
    ) : null
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
    id: 'session-841-default',
    agent_kind: 'codex',
    role: 'Workbench Session 841',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-841-default',
    inner_session_id: 'codex-thread-841',
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

function expectPersistedLayoutName(layoutId: string, expectedName: string) {
  expect(readAgentsTiledWorkbenchPersistState().layouts[layoutId]?.name).toBe(expectedName);
}

describe('agents page issue-841（平铺命名布局工作台）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    ptySpawnDialogState.mode = 'success';
    ptySpawnDialogState.lastOnSpawnError = null;
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
      yield { messageId: 'fallback-841', delta: 'fallback', done: true };
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
    runtimeClientMocks.createAgent.mockResolvedValue({ ok: true, data: { id: 'agent-841' } });
    runtimeClientMocks.deleteAgent.mockResolvedValue({ ok: true, data: { status: 'stopped', id: 'agent-841' } });
    runtimeClientMocks.stopPtyAgent.mockResolvedValue({
      ok: true,
      data: {
        id: 'pty-live-841',
        name: 'Workbench Session 841',
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

  it('preserves layout names when renaming and switching between named layouts（改名后切换布局不会串写名称）', async () => {
    const liveSession = buildSession({
      id: 'session-live-841',
      role: 'Live Session 841',
      pty_id: 'pty-live-841',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledWorkbenchPersistState({
      version: 3,
      activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'layout-review'],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: '默认布局',
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
          lastUsedAt: '2026-04-06T00:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [liveSession.id],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1', [liveSession.id]),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
        'layout-review': {
          id: 'layout-review',
          name: 'Review',
          createdAt: '2026-04-06T01:00:00.000Z',
          updatedAt: '2026-04-06T01:00:00.000Z',
          lastUsedAt: '2026-04-06T01:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x2',
            paneOrder: [],
            tree: createTemplatePaneTree('1x2'),
            slots: createTemplatePaneSlotBindings('1x2'),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [liveSession.id],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
      },
    });

    render(<AgentsPage />);

    const layoutNameInput = await screen.findByTestId('agents-tiled-layout-name-input') as HTMLInputElement;
    const layoutSelect = screen.getByTestId('agents-tiled-layout-select') as HTMLSelectElement;

    fireEvent.change(layoutNameInput, { target: { value: 'Focus' } });
    fireEvent.blur(layoutNameInput);

    await waitFor(() => {
      expectPersistedLayoutName(DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'Focus');
    });

    fireEvent.change(layoutSelect, { target: { value: 'layout-review' } });

    await waitFor(() => {
      expect(layoutNameInput.value).toBe('Review');
    });
    expectPersistedLayoutName(DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'Focus');
    expectPersistedLayoutName('layout-review', 'Review');

    fireEvent.change(layoutSelect, { target: { value: DEFAULT_TILED_WORKBENCH_LAYOUT_ID } });

    await waitFor(() => {
      expect(layoutNameInput.value).toBe('Focus');
    });
  });

  it('does not persist an active layout rename draft before commit（未提交的布局名称草稿不会提前写入持久化）', async () => {
    const liveSession = buildSession({
      id: 'session-live-841-draft',
      role: 'Live Session Draft 841',
      pty_id: 'pty-live-841-draft',
    });
    sessionStreamState.sessions = [liveSession];

    writeAgentsTiledWorkbenchPersistState({
      version: 3,
      activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: '默认布局',
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
          lastUsedAt: '2026-04-06T00:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [liveSession.id],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1', [liveSession.id]),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
      },
    });

    render(<AgentsPage />);

    const layoutNameInput = await screen.findByTestId('agents-tiled-layout-name-input') as HTMLInputElement;

    fireEvent.change(layoutNameInput, { target: { value: 'Draft Only' } });

    await waitFor(() => {
      expect(layoutNameInput.value).toBe('Draft Only');
    });
    expectPersistedLayoutName(DEFAULT_TILED_WORKBENCH_LAYOUT_ID, '默认布局');
  });

  it('creates an empty layout without copying current pane bindings and restores the source snapshot when switching back（新建空布局不复制绑定，切回时恢复原布局快照）', async () => {
    const liveSession = buildSession({
      id: 'session-live-841-empty',
      role: 'Live Session Empty 841',
      pty_id: 'pty-live-841-empty',
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

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-841-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agents-tiled-layout-new'));

    await waitFor(() => {
      const slot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(slot).getByText('空窗格')).toBeInTheDocument();
      expect(within(slot).getByRole('button', { name: '绑定 Live Session Empty 841' })).toBeInTheDocument();
    });

    const persistedAfterCreate = readAgentsTiledWorkbenchPersistState();
    const createdLayoutId = persistedAfterCreate.layoutOrder.find((layoutId) => layoutId !== DEFAULT_TILED_WORKBENCH_LAYOUT_ID);
    expect(createdLayoutId).toBeTruthy();
    expect(persistedAfterCreate.layouts[createdLayoutId ?? '']?.snapshot.unassignedSessionIds).toEqual([liveSession.id]);
    expect(persistedAfterCreate.layouts[createdLayoutId ?? '']?.snapshot.slots.every((slot) => !slot.sessionId)).toBe(true);

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: DEFAULT_TILED_WORKBENCH_LAYOUT_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-841-empty')).toBeInTheDocument();
    });
  });

  it('keeps duplicated layouts independent, deletes the active copy, and restores the default layout after reload（复制布局独立编辑后可删除，并在重载后保留默认布局）', async () => {
    const liveSession = buildSession({
      id: 'session-live-841-copy',
      role: 'Live Session Copy 841',
      pty_id: 'pty-live-841-copy',
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

    const rendered = render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-841-copy')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agents-tiled-layout-duplicate'));

    const layoutNameInput = screen.getByTestId('agents-tiled-layout-name-input') as HTMLInputElement;
    await waitFor(() => {
      expect(layoutNameInput.value).toBe('默认布局 副本');
    });

    fireEvent.click(screen.getByTitle('关闭窗格'));

    await waitFor(() => {
      const slot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(slot).getByText('空窗格')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: DEFAULT_TILED_WORKBENCH_LAYOUT_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-841-copy')).toBeInTheDocument();
    });

    const duplicatedLayoutId = readAgentsTiledWorkbenchPersistState()
      .layoutOrder
      .find((layoutId) => layoutId !== DEFAULT_TILED_WORKBENCH_LAYOUT_ID);
    expect(duplicatedLayoutId).toBeTruthy();

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: duplicatedLayoutId },
    });

    await waitFor(() => {
      const slot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(slot).getByText('空窗格')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agents-tiled-layout-delete'));

    await waitFor(() => {
      expect(layoutNameInput.value).toBe('默认布局');
    });

    expect(readAgentsTiledWorkbenchPersistState().layoutOrder).toEqual([DEFAULT_TILED_WORKBENCH_LAYOUT_ID]);

    rendered.unmount();
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-live-841-copy')).toBeInTheDocument();
    });
  });

  it('binds an asynchronously spawned PTY back to the originating layout after switching layouts（切换布局期间异步 PTY 仍回填到原始布局）', async () => {
    writeAgentsTiledWorkbenchPersistState({
      version: 3,
      activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'layout-review'],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: '默认布局',
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
          lastUsedAt: '2026-04-06T00:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1'),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
        'layout-review': {
          id: 'layout-review',
          name: 'Review',
          createdAt: '2026-04-06T01:00:00.000Z',
          updatedAt: '2026-04-06T01:00:00.000Z',
          lastUsedAt: '2026-04-06T01:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1'),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
      },
    });

    const rendered = render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tiled-slot-slot-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pty-spawn-button'));
    fireEvent.click(await screen.findByTestId('mock-pty-spawn-dialog-confirm'));

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: 'layout-review' },
    });

    await waitFor(() => {
      expect((screen.getByTestId('agents-tiled-layout-select') as HTMLSelectElement).value).toBe('layout-review');
    });

    sessionStreamState.sessions = [
      buildSession({
        id: 'session-855-live',
        role: 'Spawned Session 855',
        pty_id: 'pty-855-spawned',
      }),
    ];

    rendered.rerender(<AgentsPage />);

    await waitFor(() => {
      const reviewSlot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(reviewSlot).queryByTestId('mock-pty-terminal-pty-855-spawned')).not.toBeInTheDocument();
      expect(within(reviewSlot).getByText('空窗格')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: DEFAULT_TILED_WORKBENCH_LAYOUT_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-pty-terminal-pty-855-spawned')).toBeInTheDocument();
    });
  });

  it('surfaces tiled slot creation progress and routes failures back to the originating slot（平铺窗格创建中与失败态回到原始槽位）', async () => {
    ptySpawnDialogState.mode = 'start-only';

    writeAgentsTiledWorkbenchPersistState({
      version: 3,
      activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'layout-review'],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: '默认布局',
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
          lastUsedAt: '2026-04-06T00:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1'),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
        'layout-review': {
          id: 'layout-review',
          name: 'Review',
          createdAt: '2026-04-06T01:00:00.000Z',
          updatedAt: '2026-04-06T01:00:00.000Z',
          lastUsedAt: '2026-04-06T01:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x1',
            paneOrder: [],
            tree: createTemplatePaneTree('1x1'),
            slots: createTemplatePaneSlotBindings('1x1'),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
      },
    });

    render(<AgentsPage />);

    const originSlot = await screen.findByTestId('tiled-slot-slot-1');
    fireEvent.click(within(originSlot).getByRole('button', { name: '新建终端' }));
    fireEvent.click(await screen.findByTestId('mock-pty-spawn-dialog-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('mock-pty-spawn-dialog')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('tiled-slot-slot-1')).getByText('正在创建终端')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: 'layout-review' },
    });

    await waitFor(() => {
      expect((screen.getByTestId('agents-tiled-layout-select') as HTMLSelectElement).value).toBe('layout-review');
      expect(within(screen.getByTestId('tiled-slot-slot-1')).getByText('空窗格')).toBeInTheDocument();
    });

    ptySpawnDialogState.lastOnSpawnError?.('spawn failed');

    fireEvent.change(screen.getByTestId('agents-tiled-layout-select'), {
      target: { value: DEFAULT_TILED_WORKBENCH_LAYOUT_ID },
    });

    await waitFor(() => {
      const failedSlot = screen.getByTestId('tiled-slot-slot-1');
      expect(within(failedSlot).getAllByText('创建失败').length).toBeGreaterThan(0);
      expect(within(failedSlot).getByText('spawn failed')).toBeInTheDocument();
    });
  });
});
