import { Link, useLocation } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getProposalInboxEnabled, subscribeProposalInboxEnabledChanges } from '@/config/proposal-inbox-enabled';
import { getProposalRtAdapter } from '@/lib/adapters/proposal-rt-adapter';

type ProposalNotificationBadgePlacement =
  | 'desktop'
  | 'desktop-compact'
  | 'mobile-floating';

const POLL_INTERVAL_MS = 30_000;

function formatCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

export function ProposalNotificationBadge({
  placement = 'desktop',
}: {
  placement?: ProposalNotificationBadgePlacement;
}) {
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);
  const [proposalInboxEnabled, setProposalInboxEnabled] = useState(() => getProposalInboxEnabled());

  useEffect(() => subscribeProposalInboxEnabledChanges(setProposalInboxEnabled), []);

  useEffect(() => {
    let disposed = false;
    const adapter = getProposalRtAdapter();

    const refresh = async () => {
      try {
        const pending = await adapter.listProposals({ status: 'pending' });
        if (!disposed) {
          setPendingCount(pending.length);
        }
      } catch {
        if (!disposed) {
          setPendingCount(0);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  if (!proposalInboxEnabled || pendingCount <= 0) {
    return null;
  }

  if (placement === 'mobile-floating') {
    if (location.pathname.startsWith('/proposals')) {
      return null;
    }

    return (
      <Link
        to="/proposals"
        data-testid="proposal-mobile-floating-entry"
        className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+74px)] right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[#F5C7B8] bg-[#FFF7ED]/95 px-3 py-2 text-xs font-semibold text-[#9A3412] shadow-[0_18px_38px_-24px_rgba(154,52,18,0.6)] backdrop-blur dark:border-[#7C2D12] dark:bg-[#2A140D]/95 dark:text-[#FDBA74]"
      >
        <Inbox size={16} />
        <span>请求箱</span>
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#C75B3A] px-1.5 py-0.5 text-[10px] leading-none text-white">
          {formatCount(pendingCount)}
        </span>
      </Link>
    );
  }

  if (placement === 'desktop-compact') {
    return (
      <span
        data-testid="proposal-desktop-compact-badge"
        className="absolute right-2 top-2 inline-flex min-w-4 items-center justify-center rounded-full bg-[#C75B3A] px-1 text-[10px] font-semibold leading-none text-white"
      >
        {formatCount(pendingCount)}
      </span>
    );
  }

  return (
    <span
      data-testid="proposal-desktop-badge"
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[#FDE7DC] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#C75B3A]"
    >
      {formatCount(pendingCount)}
    </span>
  );
}
