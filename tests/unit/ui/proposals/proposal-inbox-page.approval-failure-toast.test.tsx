import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProposalInboxPage } from '@/ui/app/pages/proposals/ProposalInboxPage';
import type { Proposal } from '@/lib/types/proposal';
import type { ProposalLifecycleEvent } from '@/lib/services/proposal-lifecycle.service';

const adapterMocks = vi.hoisted(() => ({
  listProposals: vi.fn(),
  updateProposal: vi.fn(),
  addComment: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const proposalDataChangeState = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
}));
const proposalLifecycleState = vi.hoisted(() => ({
  listeners: new Set<(event: ProposalLifecycleEvent) => void>(),
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: unknown }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock('@/components/ui/toast-hook', () => ({
  toast: toastMock,
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
    title: '授权新 Agent',
    body: '请求批准一个新的 Agent 访问 profile',
    actionType: 'approve_agent_access',
    actionParams: {
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      profile_id: 'anonymous',
      scopes: ['events:read'],
    },
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
    ...overrides,
  };
}

function makeFailureEvent(proposal: Proposal, failureMessage: string): ProposalLifecycleEvent {
  return {
    topic: 'proposal.execution_failed',
    payload: {
      schemaVersion: 1,
      scopeKey: 'anonymous',
      cursor: {
        kind: 'proposal_execution_failed',
        proposalId: proposal.id,
        updatedAt: proposal.updatedAt,
        originHostId: 'desktop-host',
      },
      proposal,
      execution: {
        failureMessage,
      },
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function waitForToastDelay(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
}

describe('ProposalInboxPage approval toast（请求箱批准反馈）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposalDataChangeState.listeners.clear();
    proposalLifecycleState.listeners.clear();
    adapterMocks.addComment.mockResolvedValue(null);
  });

  it('delays the optimistic success toast until no execution_failed signal arrives（未收到执行失败信号时才延迟显示成功 toast）', async () => {
    adapterMocks.listProposals.mockResolvedValue([makeProposal()]);
    adapterMocks.updateProposal.mockResolvedValue(
      makeProposal({
        status: 'approved',
        updatedAt: '2026-04-19T09:01:00.000Z',
      }),
    );

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准执行' }));
    });

    await waitFor(() => {
      expect(adapterMocks.updateProposal).toHaveBeenCalledWith('proposal-1', { status: 'approved' });
    });
    expect(toastMock).not.toHaveBeenCalled();

    await waitForToastDelay();

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '提案已批准，RT 将尝试立即执行',
    }));
  });

  it('does not show success toast when execution_failed arrives before the approve response resolves（批准响应返回前已收到失败事件时不再误报成功）', async () => {
    const approvedAfterFailure = makeProposal({
      status: 'approved',
      updatedAt: '2026-04-19T09:01:00.000Z',
    });
    const deferred = createDeferred<Proposal | null>();
    adapterMocks.listProposals.mockResolvedValue([makeProposal()]);
    adapterMocks.updateProposal.mockImplementation(() => deferred.promise);

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准执行' }));
    });

    await waitFor(() => {
      expect(adapterMocks.updateProposal).toHaveBeenCalledWith('proposal-1', { status: 'approved' });
    });

    await act(async () => {
      proposalLifecycleState.listeners.forEach((listener) => {
        listener(makeFailureEvent(
          approvedAfterFailure,
          'proposal action is not implemented yet: approve_agent_access',
        ));
      });
    });
    deferred.resolve(approvedAfterFailure);

    await waitForToastDelay();

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('cancels the pending success toast when refreshed proposal data brings in a failure comment（失败评论通过数据刷新补齐时取消待发成功 toast）', async () => {
    adapterMocks.listProposals
      .mockResolvedValueOnce([makeProposal()])
      .mockResolvedValueOnce([makeProposal({
        status: 'approved',
        updatedAt: '2026-04-19T09:01:00.000Z',
        comments: [{
          author: {
            publisherType: 'agent',
            id: 'runtime-executor',
            name: 'Runtime Executor',
          },
          content: '批准后执行失败：proposal action is not implemented yet: approve_agent_access',
          createdAt: '2026-04-19T09:01:01.000Z',
        }],
      })]);
    adapterMocks.updateProposal.mockResolvedValue(
      makeProposal({
        status: 'approved',
        updatedAt: '2026-04-19T09:01:00.000Z',
      }),
    );

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准执行' }));
    });

    await waitFor(() => {
      expect(adapterMocks.updateProposal).toHaveBeenCalledWith('proposal-1', { status: 'approved' });
    });

    await act(async () => {
      proposalDataChangeState.listeners.forEach((listener) => listener());
    });

    await waitFor(() => {
      expect(adapterMocks.listProposals).toHaveBeenCalledTimes(2);
    });

    await waitForToastDelay();

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('does not show success toast when the approve response already contains a runtime failure comment（批准响应已带失败评论时不再发成功 toast）', async () => {
    adapterMocks.listProposals.mockResolvedValue([makeProposal()]);
    adapterMocks.updateProposal.mockResolvedValue(
      makeProposal({
        status: 'approved',
        updatedAt: '2026-04-19T09:01:00.000Z',
        comments: [{
          author: {
            publisherType: 'agent',
            id: 'runtime-executor',
            name: 'Runtime Executor',
          },
          content: '批准后执行失败：proposal action is not implemented yet: approve_agent_access',
          createdAt: '2026-04-19T09:01:00.000Z',
        }],
      }),
    );

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准执行' }));
    });

    await waitFor(() => {
      expect(adapterMocks.updateProposal).toHaveBeenCalledWith('proposal-1', { status: 'approved' });
    });

    await waitForToastDelay();

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('keeps handled proposals read-only instead of allowing stale draft edits（已处理提案进入只读态，不能再保存草稿）', async () => {
    adapterMocks.listProposals.mockResolvedValue([makeProposal({
      status: 'approved',
      comments: [{
        author: {
          publisherType: 'agent',
          id: 'runtime-executor',
          name: 'Runtime Executor',
        },
        content: '批准后执行失败：already handled',
        createdAt: '2026-04-19T09:01:00.000Z',
      }],
    })]);

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');

    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批准执行' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '暂缓' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();
    expect(screen.getByDisplayValue(/"agent_id": "agent-b"/)).toBeDisabled();
  });

  it('renders comments in chronological order even when the payload arrives shuffled（评论乱序返回时仍按 createdAt 稳定展示）', async () => {
    adapterMocks.listProposals.mockResolvedValue([makeProposal({
      status: 'approved',
      comments: [{
        author: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        content: 'newer comment',
        createdAt: '2026-04-19T09:02:00.000Z',
      }, {
        author: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        content: 'older comment',
        createdAt: '2026-04-19T09:01:00.000Z',
      }],
    })]);

    render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');

    const olderComment = screen.getByText('older comment');
    const newerComment = screen.getByText('newer comment');
    expect(olderComment.compareDocumentPosition(newerComment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('cleans up pending approval timers on unmount（组件卸载后清理待发成功 toast）', async () => {
    adapterMocks.listProposals.mockResolvedValue([makeProposal()]);
    adapterMocks.updateProposal.mockResolvedValue(
      makeProposal({
        status: 'approved',
        updatedAt: '2026-04-19T09:01:00.000Z',
      }),
    );

    const view = render(<ProposalInboxPage />);

    await screen.findAllByText('授权新 Agent');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准执行' }));
    });

    await waitFor(() => {
      expect(adapterMocks.updateProposal).toHaveBeenCalledWith('proposal-1', { status: 'approved' });
    });

    view.unmount();
    await waitForToastDelay();

    expect(toastMock).not.toHaveBeenCalled();
  });
});
