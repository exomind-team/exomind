import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiAgentTabView } from '@/ui/app/pages/agents/ApiAgentTabView';

const providerStorageMocks = vi.hoisted(() => ({
  listProviderProfiles: vi.fn(),
  resolveProviderProfile: vi.fn(),
}));

const adapterMocks = vi.hoisted(() => ({
  runSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/agent-provider/provider-profile-storage', () => ({
  listProviderProfiles: providerStorageMocks.listProviderProfiles,
  resolveProviderProfile: providerStorageMocks.resolveProviderProfile,
}));

vi.mock('@/lib/adapters/agent-session-rt-adapter', () => ({
  AgentSessionRtAdapter: class {
    runSession = adapterMocks.runSession;
    getSession = adapterMocks.getSession;
  },
}));

describe('api agent tab view（API Agent 调试页）', () => {
  beforeEach(() => {
    providerStorageMocks.listProviderProfiles.mockReturnValue([
      {
        profileId: 'registry-openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: 'https://api.openai.com/v1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        lastUsedAt: '2026-04-08T10:00:00.000Z',
      },
    ]);
    providerStorageMocks.resolveProviderProfile.mockReturnValue({
      profileId: 'registry-openai-main',
      name: 'OpenAI Main',
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      createdAt: '2026-04-08T10:00:00.000Z',
      updatedAt: '2026-04-08T10:00:00.000Z',
    });
    adapterMocks.runSession.mockReset();
    adapterMocks.getSession.mockReset();
  });

  it('submits broker turn and renders the response（提交 broker 请求并展示结果）', async () => {
    adapterMocks.runSession.mockResolvedValue({
      sessionId: 'session-api-1',
      triggerSource: 'http-request',
      provider: 'openai',
      model: 'gpt-5',
      content: '',
      assistantTurn: {
        content: '这是首轮响应',
        toolCalls: [],
      },
      toolCalls: [],
      status: 'completed',
      createdAt: '2026-04-08T10:00:00.000Z',
      completedAt: '2026-04-08T10:00:01.000Z',
    });

    render(<ApiAgentTabView />);

    fireEvent.change(
      screen.getByPlaceholderText('输入本轮用户消息，点击“发送首轮 / 继续”'),
      { target: { value: '今天有什么新进展？' } },
    );
    fireEvent.click(screen.getByTestId('api-agent-run-button'));

    await waitFor(() => {
      expect(adapterMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
        newUserMessage: '今天有什么新进展？',
        presets: [],
      }));
    });

    expect(await screen.findByText('这是首轮响应')).toBeInTheDocument();
    expect(screen.getByText('session-api-1')).toBeInTheDocument();
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
  });

  it('continues with tool results after tool call response（收到 tool call 后可继续续跑）', async () => {
    adapterMocks.runSession
      .mockResolvedValueOnce({
        sessionId: 'session-api-2',
        triggerSource: 'http-request',
        provider: 'openai',
        model: 'gpt-5',
        content: '',
        assistantTurn: {
          content: '',
          toolCalls: [
            {
              id: 'tool-call-1',
              name: 'get_recent_events',
              input: { limit: 5 },
            },
          ],
        },
        toolCalls: [
          {
            toolName: 'get_recent_events',
            input: { limit: 5 },
          },
        ],
        status: 'needs_tool_calls',
        createdAt: '2026-04-08T10:00:00.000Z',
        completedAt: '2026-04-08T10:00:01.000Z',
      })
      .mockResolvedValueOnce({
        sessionId: 'session-api-2',
        triggerSource: 'http-request',
        provider: 'openai',
        model: 'gpt-5',
        content: '',
        assistantTurn: {
          content: '已经根据工具结果继续完成。',
          toolCalls: [],
        },
        toolCalls: [
          {
            toolName: 'get_recent_events',
            input: { limit: 5 },
            output: '最近事件：A / B / C',
          },
        ],
        status: 'completed',
        createdAt: '2026-04-08T10:00:00.000Z',
        completedAt: '2026-04-08T10:00:02.000Z',
      });

    render(<ApiAgentTabView />);

    fireEvent.change(
      screen.getByPlaceholderText('输入本轮用户消息，点击“发送首轮 / 继续”'),
      { target: { value: '总结一下最近事件' } },
    );
    fireEvent.click(screen.getByTestId('api-agent-run-button'));

    await waitFor(() => {
      expect(screen.getAllByText('needs_tool_calls').length).toBeGreaterThan(0);
    });

    fireEvent.change(
      screen.getByPlaceholderText('输入该工具的结果文本，续跑时会转成 tool history。'),
      { target: { value: '最近事件：A / B / C' } },
    );
    fireEvent.click(screen.getByTestId('api-agent-continue-tools-button'));

    await waitFor(() => {
      expect(adapterMocks.runSession).toHaveBeenCalledTimes(2);
    });

    expect(adapterMocks.runSession).toHaveBeenLastCalledWith(expect.objectContaining({
      history: expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'get_recent_events',
          content: '最近事件：A / B / C',
        }),
      ]),
    }));
    expect(await screen.findByText('已经根据工具结果继续完成。')).toBeInTheDocument();
  });

  it('blocks recent_events preset without scope key（recent_events 缺少 scope key 时前端直接拦截）', async () => {
    render(<ApiAgentTabView />);

    fireEvent.click(screen.getByRole('button', { name: 'recent_events' }));
    fireEvent.change(
      screen.getByPlaceholderText('输入本轮用户消息，点击“发送首轮 / 继续”'),
      { target: { value: '总结最近事件' } },
    );

    expect(screen.getByTestId('api-agent-run-button')).toBeDisabled();
    expect(screen.getByText('当前会附带 1 个 preset。第一版先固定聚焦 `recent_events / proposal_tools`。 recent_events 已启用，发送前请先填写 Scope Key。')).toBeInTheDocument();
    expect(adapterMocks.runSession).not.toHaveBeenCalled();
  });
});
