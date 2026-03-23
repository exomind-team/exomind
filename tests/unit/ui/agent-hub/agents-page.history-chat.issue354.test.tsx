import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalRoute, SignalEvent } from '@/lib/types/signal-pool';

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

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-echo-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'echo',
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
  },
  {
    id: 'route-eventlog-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
  },
];

const SAMPLE_SIGNAL_HISTORY: SignalEvent[] = [
  {
    schema_version: 1,
    id: 'sig-001',
    topic: 'user.input.text',
    ts: 1741161600000,
    source: 'ui:test',
    origin_host_id: 'local',
    hop: 0,
    payload: { text: 'hello from signal history' },
  },
  {
    schema_version: 1,
    id: 'sig-002',
    topic: 'eventlog.appended',
    ts: 1741161601000,
    source: 'actor:eventlog',
    origin_host_id: 'local',
    hop: 1,
    payload: { text: 'saved' },
  },
];

describe('agents page signal history + right chat issue-354（历史标签与右侧聊天）', () => {
  const mockMatchMedia = (matches: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  };

  beforeEach(() => {
    window.history.pushState({}, '', '/agents');
    mockMatchMedia(true);

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1949,
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-05T10:00:00.000Z',
      agents: [
        {
          id: 'echo',
          name: 'Echo Agent',
          description: '回显输入内容',
          status: 'available',
          sourceHostId: 'host-a',
          sourceHostName: '127.0.0.1:1919',
          sourceHostAddress: '127.0.0.1:1919',
        },
      ],
      hosts: [
        {
          host: {
            id: 'host-a',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            status: 'unknown',
            createdAt: '2026-03-05T00:00:00.000Z',
            updatedAt: '2026-03-05T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [],
          topology: null,
        },
      ],
    });

    serviceMocks.getDeviceView.mockResolvedValue([]);
    serviceMocks.getAgentDetail.mockResolvedValue({
      id: 'echo',
      type: 'agent',
      title: 'Echo Agent',
      status: 'running',
      description: 'echo detail',
      icon: 'brain',
      tintColor: '#0D9488',
      stats: [],
      triggerRules: [],
      targets: [],
      recentLogs: [],
    });
    serviceMocks.getActorDetail.mockResolvedValue(null);
    serviceMocks.getConversation.mockResolvedValue([]);
    serviceMocks.streamConversation.mockImplementation(async function* () {
      yield { messageId: 'msg-a1', delta: '已收到：', done: false };
      yield { messageId: 'msg-a1', delta: '测试消息', done: true };
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
          json: async () => SAMPLE_SIGNAL_HISTORY,
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

  it('renders signal history tab with runtime data（渲染信号历史标签并展示真实数据）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-hub-page')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-view-toggle-history'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-signal-history-view')).toBeInTheDocument();
    });

    expect(screen.getByText('user.input.text')).toBeInTheDocument();
    expect(screen.getByText('eventlog.appended')).toBeInTheDocument();
    expect(screen.getByText('hello from signal history')).toBeInTheDocument();
  });

  it('supports opening right-panel chat from agent detail（支持从右侧 Agent 详情进入聊天）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-agent:echo'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-open-chat')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-open-chat'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-chat-panel')).toBeInTheDocument();
    });

    const chatPanel = screen.getByTestId('agent-rightpanel-chat-panel');
    const chatInput = screen.getByTestId('agent-rightpanel-chat-input');
    expect(chatPanel.className).toContain('bg-surface');
    expect(chatPanel.className).toContain('text-foreground');
    expect(chatInput.className).toContain('bg-card');
    expect(chatInput.className).toContain('text-foreground');
    expect(chatInput.className).toContain('border-border-card');

    fireEvent.change(screen.getByTestId('agent-rightpanel-chat-input'), {
      target: { value: '测试消息' },
    });
    fireEvent.click(screen.getByTestId('agent-rightpanel-chat-send'));

    await waitFor(() => {
      expect(screen.getByText('已收到：测试消息')).toBeInTheDocument();
    });
  });

  it('opens full-screen chat route on narrow screens（小屏点击 Agent 节点直接进入全屏聊天页）', async () => {
    mockMatchMedia(false);
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-react-flow-node-agent:echo'));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/agents/chat/echo');
    });

    expect(screen.queryByTestId('agent-rightpanel-shell')).not.toBeInTheDocument();
  });
});
