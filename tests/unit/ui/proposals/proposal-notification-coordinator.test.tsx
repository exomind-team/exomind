import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalNotificationCoordinator } from '@/ui/app/components/ProposalNotificationCoordinator';
import type { Proposal } from '@/lib/types/proposal';
import type { ProposalLifecycleEvent } from '@/lib/services/proposal-lifecycle.service';

const toastMock = vi.hoisted(() => vi.fn());

const locationState = vi.hoisted(() => ({
  pathname: '/agents',
}));

const proposalInboxFlagState = vi.hoisted(() => ({
  enabled: true,
  listeners: new Set<(enabled: boolean) => void>(),
}));

const proposalLifecycleState = vi.hoisted(() => ({
  listeners: new Set<(event: ProposalLifecycleEvent) => void>(),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: locationState.pathname }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: toastMock,
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

vi.mock('@/lib/services/proposal-lifecycle.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/proposal-lifecycle.service')>();
  return {
    ...actual,
    subscribeProposalLifecycle: (listener: (event: ProposalLifecycleEvent) => void) => {
      proposalLifecycleState.listeners.add(listener);
      return () => {
        proposalLifecycleState.listeners.delete(listener);
      };
    },
  };
});

function makeProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: 'proposal-1',
    title: 'Proposal title',
    body: 'proposal body',
    actionType: 'create_task',
    actionParams: { title: 'Created task' },
    references: [],
    status: 'pending',
    publisher: {
      publisherType: 'agent',
      id: 'agent-a',
      name: 'Agent A',
    },
    comments: [],
    createdAt: '2026-04-19T09:00:00.000Z',
    updatedAt: '2026-04-19T10:00:00.000Z',
    ...overrides,
  };
}

function emitLifecycle(event: ProposalLifecycleEvent): void {
  act(() => {
    proposalLifecycleState.listeners.forEach((listener) => listener(event));
  });
}

describe('ProposalNotificationCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/agents';
    proposalInboxFlagState.enabled = true;
    proposalInboxFlagState.listeners.clear();
    proposalLifecycleState.listeners.clear();
  });

  it('shows created toast outside the proposals route（离开提案箱页时显示新提案提示）', () => {
    render(<ProposalNotificationCoordinator />);

    emitLifecycle({
      topic: 'proposal.created',
      payload: {
        schemaVersion: 1,
        scopeKey: 'profile-local',
        cursor: {
          kind: 'proposal_created',
          proposalId: 'proposal-1',
          updatedAt: '2026-04-19T10:00:00.000Z',
          originHostId: 'desktop-host',
        },
        proposal: makeProposal(),
      },
    });

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '收到新的提案',
      description: '创建任务 · Proposal title',
    }));
  });

  it('suppresses ordinary proposal toasts on the proposals route（提案箱页内抑制 created/status_changed toast）', () => {
    locationState.pathname = '/proposals';

    render(<ProposalNotificationCoordinator />);

    emitLifecycle({
      topic: 'proposal.created',
      payload: {
        schemaVersion: 1,
        scopeKey: 'profile-local',
        cursor: {
          kind: 'proposal_created',
          proposalId: 'proposal-1',
          updatedAt: '2026-04-19T10:00:00.000Z',
          originHostId: 'desktop-host',
        },
        proposal: makeProposal(),
      },
    });
    emitLifecycle({
      topic: 'proposal.status_changed',
      payload: {
        schemaVersion: 1,
        scopeKey: 'profile-local',
        cursor: {
          kind: 'proposal_status_changed',
          proposalId: 'proposal-1',
          updatedAt: '2026-04-19T10:01:00.000Z',
          originHostId: 'desktop-host',
        },
        proposal: makeProposal({
          status: 'approved',
          updatedAt: '2026-04-19T10:01:00.000Z',
        }),
        transition: {
          fromStatus: 'pending',
          toStatus: 'approved',
        },
      },
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('does not suppress execution failure toast on the proposals route（提案箱页内仍显示执行失败提示）', () => {
    locationState.pathname = '/proposals';

    render(<ProposalNotificationCoordinator />);

    emitLifecycle({
      topic: 'proposal.execution_failed',
      payload: {
        schemaVersion: 1,
        scopeKey: 'profile-local',
        cursor: {
          kind: 'proposal_execution_failed',
          proposalId: 'proposal-1',
          updatedAt: '2026-04-19T10:02:00.000Z',
          originHostId: 'desktop-host',
        },
        proposal: makeProposal({
          status: 'approved',
          updatedAt: '2026-04-19T10:02:00.000Z',
          comments: [{
            author: {
              publisherType: 'agent',
              id: 'runtime-executor',
              name: 'Runtime Executor',
            },
            content: '批准后执行失败：not implemented',
            createdAt: '2026-04-19T10:02:00.000Z',
          }],
        }),
        execution: {
          failureMessage: 'not implemented',
        },
      },
    });

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '批准后执行失败，需要人工处理',
      variant: 'destructive',
    }));
  });

  it('does not toast when proposal inbox feature is disabled（提案箱功能关闭时不再提示）', () => {
    proposalInboxFlagState.enabled = false;

    render(<ProposalNotificationCoordinator />);

    emitLifecycle({
      topic: 'proposal.created',
      payload: {
        schemaVersion: 1,
        scopeKey: 'profile-local',
        cursor: {
          kind: 'proposal_created',
          proposalId: 'proposal-1',
          updatedAt: '2026-04-19T10:00:00.000Z',
          originHostId: 'desktop-host',
        },
        proposal: makeProposal(),
      },
    });

    expect(toastMock).not.toHaveBeenCalled();
  });
});
