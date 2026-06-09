import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentConversationPage } from '@/ui/app/pages/agents/AgentConversationPage';
import { AgentMarketPage } from '@/ui/app/pages/agents/AgentMarketPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';

const serviceMocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  streamConversation: vi.fn(),
  listMarketCategories: vi.fn(),
  getMarketItems: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getConversation: serviceMocks.getConversation,
    streamConversation: serviceMocks.streamConversation,
    listMarketCategories: serviceMocks.listMarketCategories,
    getMarketItems: serviceMocks.getMarketItems,
  }),
}));

describe('agent chat and market issue-204（对话与市场）', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    serviceMocks.getConversation.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.conversations['agent-daily'] ?? []);
    serviceMocks.streamConversation.mockImplementation(async function* () {
      yield { messageId: 'stream-1', delta: '今天共收集了 ', done: false };
      yield { messageId: 'stream-1', delta: '19 条信息', done: true };
    });
    serviceMocks.listMarketCategories.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.marketCategories);
    serviceMocks.getMarketItems.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.marketItems);
  });

  it('renders chat history and streaming response（加载历史并流式输出）', async () => {
    render(<AgentConversationPage agentId="agent-daily" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-conversation-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-conversation-header')).toBeInTheDocument();
    expect(screen.getByTestId('agent-chat-input-bar')).toBeInTheDocument();
    expect(screen.getByTestId('agent-conversation-page').className).toContain('bg-surface');
    expect(screen.getByTestId('agent-conversation-page').className).toContain('text-foreground');
    expect(screen.getByTestId('agent-chat-input-bar').className).toContain('bg-surface');
    expect(screen.getByText('你好！我是日报 Agent。有什么需要我整理的吗？')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('输入消息...');
    expect(input.className).toContain('bg-card');
    expect(input.className).toContain('text-foreground');
    expect(input.className).toContain('border-border-card');

    const agentBubble = screen.getByTestId('agent-conversation-message-agent-history');
    expect(agentBubble.className).toContain('bg-card');
    expect(agentBubble.className).toContain('border-border-card');
    expect(agentBubble.className).toContain('text-strong');

    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '今天情况如何' } });
    fireEvent.click(screen.getByTestId('agent-chat-send-button'));

    await waitFor(() => {
      expect(screen.getByText('今天共收集了 19 条信息')).toBeInTheDocument();
    });
  });

  it('renders market categories and cards（加载市场分类与卡片）', async () => {
    render(<AgentMarketPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-market-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-market-search')).toBeInTheDocument();
    expect(screen.getByTestId('agent-market-page').className).toContain('dark:bg-[#0C0A09]');
    expect(screen.getAllByText('by exomind team').length).toBeGreaterThan(0);
    expect(screen.getByText('热门推荐')).toBeInTheDocument();
    expect(screen.getByText('Code Review Agent')).toBeInTheDocument();
    expect(screen.getByText('Google Calendar 数据源')).toBeInTheDocument();
  });

  it('uses fullscreen mobile composer offset on chat route（移动端二级聊天页贴到底部安全区）', async () => {
    window.history.pushState({}, '', '/agents/chat/agent-daily');

    render(<AgentConversationPage agentId="agent-daily" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-chat-input-bar')).toBeInTheDocument();
    });

    const inputBarClassName = screen.getByTestId('agent-chat-input-bar').className;
    expect(inputBarClassName).toContain('bottom-[env(safe-area-inset-bottom,0px)]');
    expect(inputBarClassName).not.toContain('bottom-[calc(env(safe-area-inset-bottom,0px)+64px)]');
  });
});
