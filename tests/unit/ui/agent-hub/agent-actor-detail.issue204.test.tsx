import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentDetailPage } from '@/ui/app/pages/agents/AgentDetailPage';
import { ActorDetailPage } from '@/ui/app/pages/agents/ActorDetailPage';
import { AGENT_HUB_MOCK_FIXTURE } from '@/lib/adapters/mock/fixtures/agent-hub';

const serviceMocks = vi.hoisted(() => ({
  getAgentDetail: vi.fn(),
  getActorDetail: vi.fn(),
}));

const runtimeManagerMocks = vi.hoisted(() => ({
  refreshSnapshot: vi.fn(),
}));

const runtimeHostServiceMocks = vi.hoisted(() => ({
  listHosts: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({
    getAgentDetail: serviceMocks.getAgentDetail,
    getActorDetail: serviceMocks.getActorDetail,
  }),
}));

vi.mock('@/services/runtime-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtime-manager')>();
  return {
    ...actual,
    getRuntimeManager: () => runtimeManagerMocks,
  };
});

vi.mock('@/lib/services/runtime-host.service', () => ({
  getRuntimeHostService: () => runtimeHostServiceMocks,
}));

describe('agent/actor detail pages issue-204（详情页）', () => {
  beforeEach(() => {
    serviceMocks.getAgentDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.agentDetails['agent-daily']);
    serviceMocks.getActorDetail.mockResolvedValue(AGENT_HUB_MOCK_FIXTURE.actorDetails['actor-timer']);
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-11T00:00:00.000Z',
      agents: [],
      hosts: [],
    });
    runtimeHostServiceMocks.listHosts.mockResolvedValue([]);
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
    expect(screen.getByTestId('agent-detail-page').className).toContain('bg-surface');
    expect(screen.getByTestId('agent-detail-page').className).toContain('text-foreground');
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
    expect(screen.getByTestId('actor-detail-page').className).toContain('bg-surface');
    expect(screen.getByTestId('actor-detail-page').className).toContain('text-foreground');
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

  it('uses preferred runtime host for energy polling and refill（能量轮询与充能应命中目标 agent 所在主机）', async () => {
    runtimeManagerMocks.refreshSnapshot.mockResolvedValue({
      updatedAt: '2026-03-11T00:00:00.000Z',
      agents: [
        {
          id: 'agent-daily',
          name: '日报 Agent',
          description: 'Daily summary',
          status: 'available',
          sourceHostId: 'host-b',
          sourceHostName: 'Host B',
          sourceHostAddress: '10.0.0.2:2999',
        },
      ],
      hosts: [
        {
          host: {
            id: 'host-a',
            name: 'Host A',
            host: '10.0.0.1',
            port: 1999,
            status: 'unknown',
            createdAt: '2026-03-11T00:00:00.000Z',
            updatedAt: '2026-03-11T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [],
          topology: null,
        },
        {
          host: {
            id: 'host-b',
            name: 'Host B',
            host: '10.0.0.2',
            port: 2999,
            status: 'unknown',
            createdAt: '2026-03-11T00:00:00.000Z',
            updatedAt: '2026-03-11T00:00:00.000Z',
          },
          connectionState: 'online',
          agents: [
            {
              id: 'agent-daily',
              name: '日报 Agent',
              description: 'Daily summary',
              status: 'available',
              sourceHostId: 'host-b',
              sourceHostName: 'Host B',
              sourceHostAddress: '10.0.0.2:2999',
            },
          ],
          topology: null,
        },
      ],
    });

    runtimeHostServiceMocks.listHosts.mockResolvedValue([
      {
        id: 'host-a',
        name: 'Host A',
        host: '10.0.0.1',
        port: 1999,
        status: 'unknown',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      },
      {
        id: 'host-b',
        name: 'Host B',
        host: '10.0.0.2',
        port: 2999,
        status: 'unknown',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://10.0.0.2:2999/agents/agent-daily/energy' && (!init || init.method === 'GET' || init.method === undefined)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            agent_id: 'agent-daily',
            current: 0,
            max: 100,
            ratio: 0,
            tick_cost: 5,
            phase: 'dormant',
            is_dormant: true,
          }),
        } as Response;
      }
      if (url === 'http://10.0.0.2:2999/agents/agent-daily/energy/refill' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            energy: {
              agent_id: 'agent-daily',
              current: 100,
              max: 100,
              ratio: 1,
              tick_cost: 5,
              phase: 'normal',
              is_dormant: false,
            },
            revived: true,
            tick_spawned: true,
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentDetailPage agentId="agent-daily" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '充能复活' })).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.0.0.2:2999/agents/agent-daily/energy',
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: '充能复活' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://10.0.0.2:2999/agents/agent-daily/energy/refill',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).startsWith('http://10.0.0.1:1999/agents/agent-daily/energy')),
    ).toBe(false);
  });
});
