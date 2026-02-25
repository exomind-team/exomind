import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentDetailPage } from '@/ui/new/pages/agents/AgentDetailPage';
import { ActorDetailPage } from '@/ui/new/pages/agents/ActorDetailPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';

const serviceMocks = vi.hoisted(() => ({
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => serviceMocks.navigate,
}));

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getAgentDetail: serviceMocks.getAgentDetail,
    getActorDetail: serviceMocks.getActorDetail,
  }),
}));

describe('agent/actor detail pages issue-204（详情页）', () => {
  beforeEach(() => {
    serviceMocks.getAgentDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.agentDetails['agent-daily']);
    serviceMocks.getActorDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.actorDetails['actor-timer']);
    serviceMocks.navigate.mockReset();
  });

  it('renders agent detail sections and chat CTA（Agent 详情区块与对话入口）', async () => {
    render(<AgentDetailPage agentId="agent-daily" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-page')).toBeInTheDocument();
    });

    expect(screen.getAllByText('日报 Agent').length).toBeGreaterThan(0);
    expect(screen.getByTestId('agent-detail-header')).toBeInTheDocument();
    expect(screen.getByTestId('agent-detail-back-button')).toBeInTheDocument();
    expect(screen.getByText('触发规则')).toBeInTheDocument();
    expect(screen.getByText('输出目标')).toBeInTheDocument();
    expect(screen.getByTestId('agent-detail-chat-button')).toBeInTheDocument();
    expect(screen.getByTestId('agent-detail-page').className).toContain('dark:bg-[#0C0A09]');

    screen.getByTestId('agent-detail-chat-button').click();
    expect(serviceMocks.navigate).toHaveBeenCalledWith({
      to: '/agents/chat/$agentId',
      params: { agentId: 'agent-daily' },
    });
  });

  it('renders actor detail sections（Actor 详情区块）', async () => {
    render(<ActorDetailPage actorId="actor-timer" />);

    await waitFor(() => {
      expect(screen.getByTestId('actor-detail-page')).toBeInTheDocument();
    });

    expect(screen.getAllByText('定时唤醒').length).toBeGreaterThan(0);
    expect(screen.getByTestId('actor-detail-header')).toBeInTheDocument();
    expect(screen.getByText('触发规则')).toBeInTheDocument();
    expect(screen.getByText('最近执行')).toBeInTheDocument();
    expect(screen.getByTestId('actor-detail-page').className).toContain('dark:bg-[#0C0A09]');
  });

  it('renders agent empty state when detail is missing（Agent 空详情应展示空态）', async () => {
    serviceMocks.getAgentDetail.mockResolvedValueOnce(null);
    render(<AgentDetailPage agentId="agent-summary" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-empty-state')).toBeInTheDocument();
    });

    expect(screen.queryByText('Agent 详情加载中...')).not.toBeInTheDocument();
    expect(screen.getByText('未找到 Agent 详情')).toBeInTheDocument();
  });

  it('renders actor empty state when detail is missing（Actor 空详情应展示空态）', async () => {
    serviceMocks.getActorDetail.mockResolvedValueOnce(null);
    render(<ActorDetailPage actorId="actor-cleaner" />);

    await waitFor(() => {
      expect(screen.getByTestId('actor-detail-empty-state')).toBeInTheDocument();
    });

    expect(screen.queryByText('Actor 详情加载中...')).not.toBeInTheDocument();
    expect(screen.getByText('未找到 Actor 详情')).toBeInTheDocument();
  });
});
