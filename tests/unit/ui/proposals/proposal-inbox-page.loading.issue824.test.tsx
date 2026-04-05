import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProposalInboxPage } from '@/ui/app/pages/proposals/ProposalInboxPage';

const adapterMocks = vi.hoisted(() => ({
  listProposals: vi.fn(),
  updateProposal: vi.fn(),
  addComment: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());

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

describe('ProposalInboxPage loading fallback（请求箱加载失败反馈）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.updateProposal.mockResolvedValue(null);
    adapterMocks.addComment.mockResolvedValue(null);
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
});
