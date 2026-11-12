import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import { __resetSessionStreamCacheForTests, useSessionStream } from '@/hooks/useSessionStream';
import { AGENTS_VIEW_PERSISTENCE_STORAGE_KEY } from '@/ui/app/pages/agents/agents-view-persistence';
import { AGENTS_TILED_PERSISTENCE_STORAGE_KEY, writeAgentsTiledPersistState } from '@/ui/app/pages/agents/agents-tiled-persistence';
import { createTemplatePaneSlotBindings, createTemplatePaneTree } from '@/ui/app/pages/agents/tiled-pane-tree';
import type { SessionInfo } from '@/lib/types/session';

const mocks = vi.hoisted(() => ({
  getDeviceView: vi.fn(),
  getAgentDetail: vi.fn(),
  getConversation: vi.fn(),
  refreshSnapshot: vi.fn(),
  getStatus: vi.fn(),
  sessionOptions: vi.fn(),
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/lib/services', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/services')>(),
  getAgentHubService: () => ({
    getDeviceView: mocks.getDeviceView,
    getAgentDetail: mocks.getAgentDetail,
    getActorDetail: vi.fn(async () => null),
    getConversation: mocks.getConversation,
  }),
}));
vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => ({ refreshSnapshot: mocks.refreshSnapshot }),
  findPreferredRuntimeHostForAgent: () => null,
  shouldAutoPollRuntimeHost: () => true,
}));
vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => ({ getStatus: mocks.getStatus }),
}));
vi.mock('@/hooks/useSessionStream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSessionStream')>();
  return {
    ...actual,
    useSessionStream: (options: Parameters<typeof actual.useSessionStream>[0]) => {
      mocks.sessionOptions(options);
      return actual.useSessionStream(options);
    },
  };
});
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, onNodeClick }: {
    nodes?: Array<{ id: string; data?: { label?: string } }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
  }) => <div data-testid="mock-topology">
    {(nodes ?? []).map((node) => <button key={node.id} onClick={() => onNodeClick?.({}, node)}>
      {node.data?.label ?? node.id}
    </button>)}
  </div>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  useNodesState: <T,>(nodes: T[]) => [nodes, vi.fn(), vi.fn()] as const,
}));

class TestEventSource {
  static urls: string[] = [];
  constructor(url: string) { TestEventSource.urls.push(url); }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const host = {
  id: 'synthetic-host', name: 'Synthetic Runtime', host: '127.0.0.1', port: 1949,
  hostId: 'synthetic-runtime', status: 'online' as const, isLocal: true,
  createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
};
const agent = {
  id: 'synthetic-agent', name: 'Synthetic Agent', description: 'Signal node', status: 'available',
  sourceHostId: host.id, sourceHostName: host.name, sourceHostAddress: '127.0.0.1:1949',
};
const signalRoute = {
  id: 'synthetic-route', enabled: true, topic: 'user.input.text',
  target_type: 'actor', target_ref: 'eventlog',
  created_at: '2026-11-11T00:00:00.000Z', updated_at: '2026-11-11T00:00:00.000Z',
};

function linkedTerminalSession(): SessionInfo {
  return {
    id: 'synthetic-session', agent_kind: 'codex', role: 'Synthetic terminal', summary: '',
    status: 'running', interaction_mode: 'terminal', pty_id: 'missing-synthetic-pty',
    source_host_id: host.hostId, inner_session_id: 'synthetic-thread',
    context: { issue_refs: [], labels: [], work_dir: 'C:/synthetic-project' },
    created_at: '2026-11-11T00:00:00.000Z', last_active_at: '2026-11-11T00:00:00.000Z',
    turn_count: 0,
  };
}

describe('Alpha network management boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetSessionStreamCacheForTests();
    TestEventSource.urls = [];
    vi.stubGlobal('EventSource', TestEventSource);
    mocks.getDeviceView.mockResolvedValue([]);
    mocks.getStatus.mockResolvedValue({ running: true, host: host.host, port: host.port, hostId: host.hostId });
    mocks.refreshSnapshot.mockResolvedValue({
      updatedAt: host.updatedAt, agents: [agent],
      hosts: [{ host, connectionState: 'online', agents: [agent], topology: {
        host_id: host.hostId, hostname: host.name, os: 'Windows', arch: 'x64',
        uptime_secs: 60, version: '0.6.0-alpha01', port: host.port,
      } }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(['device', 'api-agent', 'sessions', 'tiled'])(
    'does not run session/PTY management when restoring %s',
    async (savedView) => {
      const terminalSession = linkedTerminalSession();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        let data: unknown = [];
        if (url.endsWith('/sessions')) data = [terminalSession];
        else if (/\/sessions\//.test(url) && init?.method === 'PUT') {
          terminalSession.status = 'completed';
          data = terminalSession;
        } else if (url.endsWith('/agents')) data = [agent];
        else if (url.endsWith('/signal-routes')) data = [signalRoute];
        return { ok: true, status: 200, json: async () => data } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const cached = renderHook(() => useSessionStream({
        rtBaseUrl: null,
        targets: [{ id: host.hostId, rtBaseUrl: 'http://127.0.0.1:1949' }],
        enabled: true,
      }));
      await waitFor(() => expect(cached.result.current.sessions).toHaveLength(1));
      cached.unmount();
      fetchMock.mockClear();
      mocks.sessionOptions.mockClear();
      TestEventSource.urls = [];
      localStorage.setItem('exomind:apiAgentTabEnabled', 'true');
      localStorage.setItem('exomind:developerMode', 'true');
      localStorage.setItem(AGENTS_VIEW_PERSISTENCE_STORAGE_KEY, savedView);
      writeAgentsTiledPersistState({
        version: 2, layout: '1x1', paneOrder: [terminalSession.id],
        tree: createTemplatePaneTree('1x1'),
        slots: createTemplatePaneSlotBindings('1x1', [terminalSession.id]),
        unassignedSessionIds: [], unassignedPoolCollapsed: false, immersive: false,
        fullscreenPtyId: terminalSession.pty_id,
        fullscreenTerminalRecovery: {
          agentType: 'codex', sessionId: terminalSession.id,
          innerSessionId: terminalSession.inner_session_id!, workdir: 'C:/synthetic-project',
          sourceHostId: host.hostId,
        },
      });
      const storedTerminalLayout = localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY);
      vi.useFakeTimers();
      await act(async () => { render(<AgentsPage />); });
      expect(screen.getByTestId('agent-device-view')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(8_100));

      expect(mocks.refreshSnapshot.mock.calls.length).toBeGreaterThan(1);
      expect(mocks.sessionOptions).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
      expect(fetchMock.mock.calls.some(([input]) => /\/(?:sessions|pty)(?:[/?]|$)/.test(String(input)))).toBe(false);
      expect(TestEventSource.urls.some((url) => url.includes('/sessions/stream'))).toBe(false);
      expect(terminalSession.status).toBe('running');
      expect(localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY)).toBe(storedTerminalLayout);
      expect(screen.queryByTestId('agent-rightpanel-pty-terminal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pty-spawn-button')).not.toBeInTheDocument();
      for (const label of ['会话', '平铺', 'API Agent']) {
        expect(screen.queryByRole('tab', { name: label })).not.toBeInTheDocument();
      }

      fireEvent.click(screen.getByTestId('agent-add-node-button'));
      expect(screen.getByTestId('agent-add-node-option-device')).toBeInTheDocument();
      for (const kind of ['claude_cli', 'codex_cli', 'api', 'echo']) {
        expect(screen.queryByTestId(`agent-add-node-option-${kind}`)).not.toBeInTheDocument();
      }
      expect(screen.queryByTestId('agent-create-sheet')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('agent-add-node-close'));

      fireEvent.click(screen.getByRole('tab', { name: '节点' }));
      fireEvent.click(screen.getByText('Synthetic Agent'));
      expect(mocks.getAgentDetail).not.toHaveBeenCalled();
      expect(mocks.getConversation).not.toHaveBeenCalled();
      expect(screen.queryByTestId('agent-rightpanel-open-chat')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: '路由' }));
      expect(screen.getByText('信号路由')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/signal-routes'))).toBe(true);
    },
  );
});
