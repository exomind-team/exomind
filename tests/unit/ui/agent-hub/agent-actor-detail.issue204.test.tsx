import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentDetailPage } from '@/ui/new/pages/agents/AgentDetailPage';
import { ActorDetailPage } from '@/ui/new/pages/agents/ActorDetailPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';

const serviceMocks = vi.hoisted(() => ({
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
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
  });
});
