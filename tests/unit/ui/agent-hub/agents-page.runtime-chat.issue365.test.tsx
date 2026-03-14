import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsPage } from '@/ui/app/pages/AgentsPage';
import type { SignalRoute } from '@/lib/types/signal-pool';

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
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getAgentEnergy: vi.fn(),
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
  findPreferredRuntimeHostForAgent: vi.fn((snapshots, agentId, preferredHostId) => {
    const exact = preferredHostId
      ? snapshots.find((snapshot: any) => (
        snapshot.host.id === preferredHostId
        && snapshot.agents.some((agent: any) => agent.id === agentId)
      ))
      : null;
    if (exact) return exact.host;
    const match = snapshots.find((snapshot: any) => snapshot.agents.some((agent: any) => agent.id === agentId));
    return match?.host ?? null;
  }),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/services/runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtime-client')>();
  class RuntimeClientMock {
    streamAgentConversation = runtimeClientMocks.streamAgentConversation;

    createAgent = runtimeClientMocks.createAgent;

    deleteAgent = runtimeClientMocks.deleteAgent;

    getAgentEnergy = runtimeClientMocks.getAgentEnergy;
  }

  return {
    ...actual,
    RuntimeClient: RuntimeClientMock,
  };
});

const SAMPLE_SIGNAL_ROUTES: SignalRoute[] = [
  {
    id: 'route-claude-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'claude',
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
  },
];

describe('agents page runtime chat issue-365（运行时 Agent 对话）', () => {
  beforeEach(() => {
    localStorage.clear();

    runtimeControlMocks.getStatus.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 1949,
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-05T10:00:00.000Z',
      agents: [
        {
          id: 'claude',
          name: 'Claude Agent',
          description: 'Claude CLI runtime agent',
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
          agents: [
            {
              id: 'claude',
              name: 'Claude Agent',
              description: 'Claude CLI runtime agent',
              status: 'available',
              sourceHostId: 'host-a',
              sourceHostName: '127.0.0.1:1919',
              sourceHostAddress: '127.0.0.1:1919',
            },
          ],
          topology: null,
        },
      ],
    });

    serviceMocks.getDeviceView.mockResolvedValue([]);
    serviceMocks.getAgentDetail.mockResolvedValue({
      id: 'claude',
      type: 'agent',
      title: 'Claude Agent',
      status: 'running',
      description: 'claude detail',
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
      yield { messageId: 'msg-fallback', delta: '这是本地 adapter 的占位回复', done: true };
    });
    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* () {
      yield { type: 'session.started', sessionId: 'sid-365' };
      yield { type: 'output.delta', content: '这是 Claude Runtime 的' };
      yield { type: 'tool.call', name: 'searchDocs', payload: { query: '测试消息' } };
      yield { type: 'output.delta', content: '真实回复' };
      yield { type: 'done' };
    });
    runtimeClientMocks.getAgentEnergy.mockResolvedValue(null);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/signal-routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_SIGNAL_ROUTES,
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

  it('uses runtime chat stream for Claude agent（Claude 对话应走 Runtime 实时流）', async () => {
    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '节点' }));

    await waitFor(() => {
      expect(screen.getByTestId('agent-list-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Claude Agent'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-open-chat')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-open-chat'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-chat-panel')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-rightpanel-chat-input'), {
      target: { value: '测试消息' },
    });
    fireEvent.click(screen.getByTestId('agent-rightpanel-chat-send'));

    await waitFor(() => {
      const outputs = screen.getAllByTestId('agent-runtime-event-output');
      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toHaveTextContent('这是 Claude Runtime 的');
      expect(outputs[1]).toHaveTextContent('真实回复');
      expect(screen.getByTestId('agent-runtime-event-tool-call')).toHaveTextContent('searchDocs');
    });

    expect(runtimeClientMocks.streamAgentConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      expect.objectContaining({
        agentId: 'claude',
        message: '测试消息',
      }),
    );
    expect(serviceMocks.streamConversation).not.toHaveBeenCalled();
  });

  it('reuses runtime session after closing and reopening chat（关闭后重新打开仍应续上同一会话）', async () => {
    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* (_host, request) {
      if (request.message === '第一轮消息') {
        yield { type: 'session.started', sessionId: 'sid-365-reopen' };
        yield { type: 'output.delta', content: '首轮回复' };
        yield { type: 'done' };
        return;
      }

      yield { type: 'output.delta', content: `resume:${request.sessionId ?? 'missing'}` };
      yield { type: 'done' };
    });

    render(<AgentsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-topology-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '节点' }));

    await waitFor(() => {
      expect(screen.getByTestId('agent-list-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Claude Agent'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-open-chat')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-open-chat'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-chat-panel')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-rightpanel-chat-input'), {
      target: { value: '第一轮消息' },
    });
    fireEvent.click(screen.getByTestId('agent-rightpanel-chat-send'));

    await waitFor(() => {
      expect(screen.getByText('首轮回复')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByText('Claude Agent'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-open-chat')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-rightpanel-open-chat'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-rightpanel-chat-panel')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-rightpanel-chat-input'), {
      target: { value: '第二轮消息' },
    });
    fireEvent.click(screen.getByTestId('agent-rightpanel-chat-send'));

    await waitFor(() => {
      expect(screen.getByText('resume:sid-365-reopen')).toBeInTheDocument();
    });

    expect(runtimeClientMocks.streamAgentConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      expect.objectContaining({
        agentId: 'claude',
        message: '第二轮消息',
        sessionId: 'sid-365-reopen',
      }),
    );
  });
});
