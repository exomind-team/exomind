import { useEffect, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { toast } from '@/components/ui/toast-hook';
import {
  getProposalInboxEnabled,
  subscribeProposalInboxEnabledChanges,
} from '@/config/proposal-inbox-enabled';
import {
  subscribeProposalLifecycle,
  type ProposalLifecycleEvent,
} from '@/lib/services/proposal-lifecycle.service';
import {
  resolveProposalActionLabel,
  resolveProposalStatusMeta,
} from '@/ui/app/pages/proposals/proposal-inbox-utils';

function shouldSuppressProposalToast(
  pathname: string,
  event: ProposalLifecycleEvent,
): boolean {
  if (!pathname.startsWith('/proposals')) {
    return false;
  }

  return event.topic !== 'proposal.execution_failed';
}

function emitProposalToast(event: ProposalLifecycleEvent): void {
  switch (event.topic) {
    case 'proposal.created':
      toast({
        title: '收到新的请求',
        description: `${resolveProposalActionLabel(event.payload.proposal.actionType)} · ${event.payload.proposal.title}`,
      });
      return;

    case 'proposal.status_changed': {
      const statusMeta = resolveProposalStatusMeta(event.payload.transition.toStatus);
      toast({
        title: `请求状态已更新：${statusMeta.label}`,
        description: event.payload.proposal.title,
      });
      return;
    }

    case 'proposal.execution_failed':
      toast({
        title: '批准后执行失败，需要人工处理',
        description: `${event.payload.proposal.title} · ${event.payload.execution.failureMessage}`,
        variant: 'destructive',
      });
      return;
  }
}

export function ProposalNotificationCoordinator(): null {
  const location = useLocation();
  const [proposalInboxEnabled, setProposalInboxEnabled] = useState(() => getProposalInboxEnabled());

  useEffect(() => subscribeProposalInboxEnabledChanges(setProposalInboxEnabled), []);

  useEffect(() => {
    const unsubscribe = subscribeProposalLifecycle((event) => {
      if (!proposalInboxEnabled) {
        return;
      }

      if (shouldSuppressProposalToast(location.pathname, event)) {
        return;
      }

      emitProposalToast(event);
    });

    return unsubscribe;
  }, [location.pathname, proposalInboxEnabled]);

  return null;
}
