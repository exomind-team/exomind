import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentConversationPage } from '@/ui/app/pages/agents/AgentConversationPage';

const serviceMocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  streamConversation: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
}));

const runtimeClientMocks = vi.hoisted(() => ({
  streamAgentConversation: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getConversation: serviceMocks.getConversation,
    streamConversation: serviceMocks.streamConversation,
  }),
}));

vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => runtimeManagerMocks,
  findPreferredRuntimeHostForAgent: vi.fn((snapshots, agentId) => {
    const match = snapshots.find((snapshot: any) => snapshot.agents.some((agent: any) => agent.id === agentId));
    return match?.host ?? null;
  }),
  shouldAutoPollRuntimeHost: vi.fn(() => true),
}));

vi.mock('@/services/runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtime-client')>();

  class RuntimeClientMock {
    streamAgentConversation = runtimeClientMocks.streamAgentConversation;
  }

  return {
    ...actual,
    RuntimeClient: RuntimeClientMock,
  };
});

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

describe('agent conversation runtime issue-385（运行时对话页 typed event 渲染）', () => {
  beforeEach(() => {
    localStorage.clear();

    serviceMocks.getConversation.mockResolvedValue([]);
    serviceMocks.streamConversation.mockImplementation(async function* () {
      yield { messageId: 'fallback-1', delta: 'fallback', done: true };
    });

    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-07T10:00:00.000Z',
      agents: [
        {
          id: 'codex',
          name: 'Codex Agent',
          description: 'Codex runtime agent',
          status: 'available',
          sourceHostId: 'host-codex',
          sourceHostName: '127.0.0.1:1919',
          sourceHostAddress: '127.0.0.1:1919',
        },
      ],
      hosts: [
        {
          host: {
            id: 'host-codex',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
            status: 'unknown',
            createdAt: '2026-03-07T00:00:00.000Z',
            updatedAt: '2026-03-07T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [
            {
              id: 'codex',
              name: 'Codex Agent',
              description: 'Codex runtime agent',
              status: 'available',
              sourceHostId: 'host-codex',
              sourceHostName: '127.0.0.1:1919',
              sourceHostAddress: '127.0.0.1:1919',
            },
          ],
          topology: null,
        },
      ],
    });

    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* (_host, request) {
      if (request.message === '第一条消息') {
        yield { type: 'session.started', sessionId: 'session-385' };
        yield { type: 'thinking.delta', content: '正在分析 issue-385' };
        yield { type: 'tool.call', name: 'searchDocs', payload: { query: 'codex exec' } };
        yield { type: 'tool.result', name: 'searchDocs', payload: { hits: 2 } };
        yield { type: 'output.delta', content: '你好，我是 ' };
        yield { type: 'tool.call', name: 'runTask', payload: { task: 'issue-385' } };
        yield { type: 'output.delta', content: 'Codex' };
        yield { type: 'done' };
        return;
      }

      yield { type: 'output.delta', content: `session:${request.sessionId ?? 'missing'}` };
      yield { type: 'done' };
    });
  });

  it('renders typed runtime events and reuses session id（渲染 typed 事件并复用 sessionId）', async () => {
    render(<AgentConversationPage agentId="codex" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-conversation-page')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: '第一条消息' },
    });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-runtime-event-thinking')).toHaveTextContent('正在分析 issue-385');
      expect(screen.getByTestId('agent-runtime-event-tool-result')).toHaveTextContent('"hits":2');
      const toolCalls = screen.getAllByTestId('agent-runtime-event-tool-call');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]).toHaveTextContent('searchDocs');
      expect(toolCalls[1]).toHaveTextContent('runTask');
      const outputs = screen.getAllByTestId('agent-runtime-event-output');
      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toHaveTextContent('你好，我是');
      expect(outputs[1]).toHaveTextContent('Codex');
    });

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: '第二条消息' },
    });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      const outputs = screen.getAllByTestId('agent-runtime-event-output');
      expect(outputs[outputs.length - 1]).toHaveTextContent('session:session-385');
    });

    expect(runtimeClientMocks.streamAgentConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      expect.objectContaining({
        agentId: 'codex',
        message: '第一条消息',
        sessionId: undefined,
      }),
    );
    expect(runtimeClientMocks.streamAgentConversation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      expect.objectContaining({
        agentId: 'codex',
        message: '第二条消息',
        sessionId: 'session-385',
      }),
    );
    expect(serviceMocks.streamConversation).not.toHaveBeenCalled();
  });

  it('shows load failure when history request fails（历史加载失败时展示错误）', async () => {
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-07T10:10:00.000Z',
      agents: [],
      hosts: [],
    });
    serviceMocks.getConversation.mockRejectedValue(new Error('history unavailable'));

    render(<AgentConversationPage agentId="codex" />);

    await waitFor(() => {
      expect(screen.getByText('加载会话失败: history unavailable')).toBeInTheDocument();
    });
  });

  it('shows send failure when runtime stream throws（发送失败时展示错误）', async () => {
    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* () {
      throw new Error('runtime disconnected');
    });

    render(<AgentConversationPage agentId="codex" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-conversation-page')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: '第一条消息' },
    });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      expect(screen.getByText('发送失败: runtime disconnected')).toBeInTheDocument();
    });
  });

  it('reuses remembered runtime session after remount（重新进入页面后继续复用 runtime session）', async () => {
    runtimeClientMocks.streamAgentConversation.mockImplementation(async function* (_host, request) {
      if (request.message === '第一条消息') {
        yield { type: 'session.started', sessionId: 'session-385-remount' };
        yield { type: 'output.delta', content: '首轮输出' };
        yield { type: 'done' };
        return;
      }

      yield { type: 'output.delta', content: `resume:${request.sessionId ?? 'missing'}` };
      yield { type: 'done' };
    });

    const firstRender = render(<AgentConversationPage agentId="codex" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-conversation-page')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: '第一条消息' },
    });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      expect(screen.getByText('首轮输出')).toBeInTheDocument();
    });

    firstRender.unmount();

    render(<AgentConversationPage agentId="codex" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-conversation-page')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: '第二条消息' },
    });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      expect(screen.getByText('resume:session-385-remount')).toBeInTheDocument();
    });

    expect(runtimeClientMocks.streamAgentConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1919,
      }),
      expect.objectContaining({
        agentId: 'codex',
        message: '第二条消息',
        sessionId: 'session-385-remount',
      }),
    );
  });
});
