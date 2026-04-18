import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ProposalInboxPage } from '@/ui/app/pages/proposals/ProposalInboxPage';

const adapterMocks = vi.hoisted(() => ({
  listProposals: vi.fn(),
  updateProposal: vi.fn(),
  addComment: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());
const proposalDataChangeState = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: unknown }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/adapters/proposal-rt-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adapters/proposal-rt-adapter')>();
  return {
    ...actual,
    getProposalRtAdapter: () => adapterMocks,
  };
});

vi.mock('@/lib/services/proposal-data-change.service', () => ({
  subscribeProposalDataChanges: (listener: () => void) => {
    proposalDataChangeState.listeners.add(listener);
    return () => {
      proposalDataChangeState.listeners.delete(listener);
    };
  },
}));

describe('ProposalInboxPage loading fallback（请求箱加载失败反馈）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.updateProposal.mockResolvedValue(null);
    adapterMocks.addComment.mockResolvedValue(null);
    proposalDataChangeState.listeners.clear();
  });

  it('shows an error instead of staying on the loading state when the RT request times out（RT 超时时不再一直卡在加载中）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapterMocks.listProposals.mockRejectedValueOnce(
      new Error('RT proposal request timed out（请求超时）'),
    );

    render(<ProposalInboxPage />);

    await waitFor(() => {
      expect(screen.queryByText('请求箱加载中...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('RT proposal request timed out（请求超时）')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      '[proposal-inbox] failed to load proposals',
      expect.objectContaining({
        silent: false,
        missingEndpoint: false,
        message: 'RT proposal request timed out（请求超时）',
      }),
    );

    warnSpy.mockRestore();
  });

  it('refreshes immediately when proposal data changes are notified（收到 proposal 数据变更时立即刷新请求箱）', async () => {
    adapterMocks.listProposals
      .mockResolvedValueOnce([{
        id: 'proposal-1',
        title: 'Initial proposal',
        body: '',
        actionType: 'append_event',
        actionParams: { content: 'initial' },
        references: [],
        status: 'pending',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T09:00:00.000Z',
      }])
      .mockResolvedValueOnce([{
        id: 'proposal-2',
        title: 'Refreshed proposal',
        body: '',
        actionType: 'append_event',
        actionParams: { content: 'refreshed' },
        references: [],
        status: 'pending',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T10:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      }]);

    render(<ProposalInboxPage />);

    const initialTitles = await screen.findAllByText('Initial proposal');
    expect(initialTitles.length).toBeGreaterThan(0);

    act(() => {
      proposalDataChangeState.listeners.forEach((listener) => listener());
    });

    await waitFor(() => {
      expect(adapterMocks.listProposals).toHaveBeenCalledTimes(2);
    });
    const refreshedTitles = screen.getAllByText('Refreshed proposal');
    expect(refreshedTitles.length).toBeGreaterThan(0);
  });
});
