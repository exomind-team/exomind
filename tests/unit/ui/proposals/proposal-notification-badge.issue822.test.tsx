import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ProposalNotificationBadge } from '@/ui/app/components/ProposalNotificationBadge';

const adapterMocks = vi.hoisted(() => ({
  listProposals: vi.fn(),
}));

const proposalInboxFlagState = vi.hoisted(() => ({
  enabled: true,
  listeners: new Set<(enabled: boolean) => void>(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: unknown }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/agents' }),
}));

vi.mock('@/config/proposal-inbox-enabled', () => ({
  getProposalInboxEnabled: () => proposalInboxFlagState.enabled,
  subscribeProposalInboxEnabledChanges: (listener: (enabled: boolean) => void) => {
    proposalInboxFlagState.listeners.add(listener);
    return () => {
      proposalInboxFlagState.listeners.delete(listener);
    };
  },
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: () => ({
    mode: 'embedded',
    host: '127.0.0.1',
    port: 9124,
  }),
  formatRuntimeTargetAddress: () => '127.0.0.1:9124',
}));

vi.mock('@/lib/adapters/proposal-rt-adapter', () => ({
  getProposalRtAdapter: () => adapterMocks,
}));

describe('ProposalNotificationBadge observability（请求箱角标失败日志）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposalInboxFlagState.enabled = true;
    proposalInboxFlagState.listeners.clear();
  });

  it('logs a traceable warning when pending proposal refresh fails（轮询失败时输出可追溯告警）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapterMocks.listProposals.mockRejectedValueOnce(new Error('runtime unavailable'));

    render(<ProposalNotificationBadge placement="desktop" />);

    await waitFor(() => {
      expect(adapterMocks.listProposals).toHaveBeenCalledWith({ status: 'pending' });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[proposal-badge] failed to refresh pending proposal count',
      expect.objectContaining({
        placement: 'desktop',
        targetMode: 'embedded',
        targetAddress: '127.0.0.1:9124',
        message: 'runtime unavailable',
      }),
    );

    warnSpy.mockRestore();
  });

  it('does not poll the RT when proposal inbox entry is disabled（请求箱入口关闭时不再轮询 RT）', () => {
    proposalInboxFlagState.enabled = false;

    render(<ProposalNotificationBadge placement="desktop" />);

    expect(adapterMocks.listProposals).not.toHaveBeenCalled();
  });
});
