import { EventMarkdown } from '@/components/Chat/EventMarkdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast-hook';
import {
  formatRuntimeTargetAddress,
  getSelectedRuntimeTarget,
} from '@/config/runtime-target';
import {
  ProposalRtError,
  getProposalRtAdapter,
} from '@/lib/adapters/proposal-rt-adapter';
import type {
  Proposal,
  ProposalPublisher,
  ProposalReference,
  ProposalStatus,
} from '@/lib/types/proposal';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import {
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatProposalAbsoluteTime,
  formatProposalRelativeTime,
  normalizeProposalActionParams,
  resolveProposalActionLabel,
  resolveProposalReferenceLabel,
  resolveProposalStatusMeta,
  sortProposals,
  tryParseProposalActionParams,
} from './proposal-inbox-utils';

type ProposalFilterKey = 'all' | ProposalStatus;

const POLL_INTERVAL_MS = 30_000;

const FILTER_OPTIONS: Array<{ key: ProposalFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'in_review', label: '审议中' },
  { key: 'approved', label: '已批准' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'snoozed', label: '已暂缓' },
];

const STATUS_TONE_CLASSES = {
  warning: {
    pill: 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A1B11] dark:text-[#FDBA74]',
    dot: 'bg-[#C75B3A]',
  },
  info: {
    pill: 'bg-[#EFF6FF] text-[#2563EB] dark:bg-[#172554] dark:text-[#93C5FD]',
    dot: 'bg-[#2563EB]',
  },
  success: {
    pill: 'bg-[#E8F5E9] text-[#15803D] dark:bg-[#0F2416] dark:text-[#86EFAC]',
    dot: 'bg-[#15803D]',
  },
  danger: {
    pill: 'bg-[#FEE2E2] text-[#B91C1C] dark:bg-[#3A1111] dark:text-[#FCA5A5]',
    dot: 'bg-[#B91C1C]',
  },
  muted: {
    pill: 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]',
    dot: 'bg-[#78716C]',
  },
} as const;

const DEFAULT_COMMENT_AUTHOR: ProposalPublisher = {
  publisherType: 'human',
  id: 'ui-reviewer',
  name: 'UI Reviewer',
};

function resolveSelection(
  proposals: Proposal[],
  currentId: number | null,
): number | null {
  if (currentId !== null && proposals.some((proposal) => proposal.id === currentId)) {
    return currentId;
  }
  return proposals[0]?.id ?? null;
}

function replaceProposalInList(
  proposals: Proposal[],
  nextProposal: Proposal,
): Proposal[] {
  return sortProposals(
    proposals.some((proposal) => proposal.id === nextProposal.id)
      ? proposals.map((proposal) => (
        proposal.id === nextProposal.id ? nextProposal : proposal
      ))
      : [...proposals, nextProposal],
  );
}

function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  const meta = resolveProposalStatusMeta(status);
  const tone = STATUS_TONE_CLASSES[meta.tone];

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold', tone.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      <span>{meta.label}</span>
    </span>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{value}</p>
      <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{hint}</p>
    </article>
  );
}

function ProposalReferenceAction({
  reference,
}: {
  reference: ProposalReference;
}) {
  const navigate = useNavigate();

  if (reference.refType === 'task') {
    return (
      <Link
        to="/tasks/$taskId"
        params={{ taskId: reference.id }}
        className="inline-flex items-center rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs font-medium text-[#57534E] transition-colors hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
      >
        打开任务
      </Link>
    );
  }

  if (reference.refType === 'timeblock') {
    return (
      <Link
        to="/eventlog/timeblocks/$blockId"
        params={{ blockId: reference.id }}
        className="inline-flex items-center rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs font-medium text-[#57534E] transition-colors hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
      >
        打开时间块
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void navigate({
          to: '/eventlog',
          search: {
            tab: 'record',
            focusEventId: reference.id,
          } as never,
        });
      }}
      className="inline-flex items-center rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs font-medium text-[#57534E] transition-colors hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
    >
      打开记录
    </button>
  );
}

export function ProposalInboxPage() {
  const isDesktop = useIsDesktop();
  const adapter = getProposalRtAdapter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<ProposalFilterKey>('all');
  const [actionParamsText, setActionParamsText] = useState('{}');
  const [commentDraft, setCommentDraft] = useState('');
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);

  const loadProposals = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const next = sortProposals(await adapter.listProposals());
      setProposals(next);
      setSelectedProposalId((current) => resolveSelection(next, current));
      setErrorMessage(null);
      setEndpointMissing(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求箱加载失败';
      const missingEndpoint = error instanceof ProposalRtError && error.status === 404;
      const target = getSelectedRuntimeTarget();
      console.warn('[proposal-inbox] failed to load proposals', {
        silent,
        targetMode: target.mode,
        targetAddress: formatRuntimeTargetAddress(target),
        missingEndpoint,
        message,
      });
      setErrorMessage(message);
      setEndpointMissing(missingEndpoint);
      if (missingEndpoint) {
        setProposals([]);
        setSelectedProposalId(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adapter]);

  useEffect(() => {
    let disposed = false;

    const initialLoad = async () => {
      if (!disposed) {
        await loadProposals();
      }
    };

    void initialLoad();
    const intervalId = window.setInterval(() => {
      if (!disposed) {
        void loadProposals({ silent: true });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [loadProposals]);

  const counts = useMemo(() => ({
    pending: proposals.filter((proposal) => proposal.status === 'pending').length,
    in_review: proposals.filter((proposal) => proposal.status === 'in_review').length,
    handled: proposals.filter((proposal) => (
      proposal.status === 'approved'
      || proposal.status === 'rejected'
      || proposal.status === 'snoozed'
    )).length,
  }), [proposals]);

  const visibleProposals = useMemo(() => (
    activeFilter === 'all'
      ? proposals
      : proposals.filter((proposal) => proposal.status === activeFilter)
  ), [activeFilter, proposals]);

  useEffect(() => {
    if (visibleProposals.length === 0) {
      setSelectedProposalId(null);
      return;
    }
    setSelectedProposalId((current) => resolveSelection(visibleProposals, current));
  }, [visibleProposals]);

  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.id === selectedProposalId) ?? null,
    [proposals, selectedProposalId],
  );

  useEffect(() => {
    if (!selectedProposal) {
      setActionParamsText('{}');
      setCommentDraft('');
      return;
    }

    setActionParamsText(normalizeProposalActionParams(selectedProposal.actionParams));
    setCommentDraft('');
  }, [selectedProposal?.id, selectedProposal?.updatedAt]);

  const parsedActionParams = useMemo(
    () => tryParseProposalActionParams(actionParamsText),
    [actionParamsText],
  );

  const normalizedSelectedActionParams = selectedProposal
    ? normalizeProposalActionParams(selectedProposal.actionParams)
    : '{}';

  const actionParamsDirty = selectedProposal
    ? parsedActionParams.error === null
      ? normalizeProposalActionParams(parsedActionParams.parsed) !== normalizedSelectedActionParams
      : actionParamsText.trim() !== normalizedSelectedActionParams.trim()
    : false;

  const editableTaskTitle = useMemo(() => {
    if (!selectedProposal || parsedActionParams.error || !parsedActionParams.parsed) {
      return '';
    }
    const title = parsedActionParams.parsed.title;
    return typeof title === 'string' ? title : '';
  }, [parsedActionParams.error, parsedActionParams.parsed, selectedProposal]);

  const updateEditableTaskTitle = (nextTitle: string) => {
    const base = parsedActionParams.parsed ?? {};
    setActionParamsText(normalizeProposalActionParams({
      ...base,
      title: nextTitle,
    }));
  };

  const mutateSelectedProposal = async (
    key: string,
    fn: () => Promise<Proposal | null>,
    successTitle: string,
    failureTitle: string,
  ) => {
    setSubmittingKey(key);
    try {
      const nextProposal = await fn();
      if (!nextProposal) {
        throw new Error('提案已不存在或已被移除');
      }
      setProposals((current) => replaceProposalInList(current, nextProposal));
      setSelectedProposalId(nextProposal.id);
      toast({ title: successTitle });
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败';
      toast({
        title: failureTitle,
        description: message,
        variant: 'destructive',
      });
      if (error instanceof ProposalRtError && error.status === 404) {
        setEndpointMissing(true);
      }
    } finally {
      setSubmittingKey(null);
    }
  };

  const saveDraft = async () => {
    if (!selectedProposal || parsedActionParams.error || !parsedActionParams.parsed) {
      toast({
        title: '保存草稿失败',
        description: parsedActionParams.error ?? '未选中提案',
        variant: 'destructive',
      });
      return;
    }

    await mutateSelectedProposal(
      'save',
      () => adapter.updateProposal(selectedProposal.id, {
        actionParams: parsedActionParams.parsed ?? {},
      }),
      '已保存提案参数',
      '保存草稿失败',
    );
  };

  const approveProposal = async () => {
    if (!selectedProposal || parsedActionParams.error || !parsedActionParams.parsed) {
      toast({
        title: '批准失败',
        description: parsedActionParams.error ?? '未选中提案',
        variant: 'destructive',
      });
      return;
    }

    await mutateSelectedProposal(
      'approve',
      async () => {
        const updated = actionParamsDirty
          ? await adapter.updateProposal(selectedProposal.id, {
            actionParams: parsedActionParams.parsed ?? {},
          })
          : selectedProposal;

        if (!updated) {
          return null;
        }

        return adapter.updateProposal(updated.id, { status: 'approved' });
      },
      '提案已批准，RT 将尝试立即执行',
      '批准提案失败',
    );
  };

  const rejectProposal = async () => {
    if (!selectedProposal) {
      return;
    }

    await mutateSelectedProposal(
      'reject',
      () => adapter.updateProposal(selectedProposal.id, { status: 'rejected' }),
      '提案已拒绝',
      '拒绝提案失败',
    );
  };

  const snoozeProposal = async () => {
    if (!selectedProposal) {
      return;
    }

    await mutateSelectedProposal(
      'snooze',
      () => adapter.updateProposal(selectedProposal.id, { status: 'snoozed' }),
      '提案已暂缓',
      '暂缓提案失败',
    );
  };

  const addComment = async () => {
    if (!selectedProposal) {
      return;
    }

    const content = commentDraft.trim();
    if (!content) {
      return;
    }

    setSubmittingKey('comment');
    try {
      const nextProposal = await adapter.addComment(
        selectedProposal.id,
        content,
        DEFAULT_COMMENT_AUTHOR,
      );
      setProposals((current) => replaceProposalInList(current, nextProposal));
      setSelectedProposalId(nextProposal.id);
      setCommentDraft('');
      toast({ title: '评论已添加' });
    } catch (error) {
      if (error instanceof ProposalRtError && error.status === 404) {
        setEndpointMissing(true);
      }
      toast({
        title: '评论添加失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      });
    } finally {
      setSubmittingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-6 text-sm text-[#78716C] dark:text-[#A8A29E]">
        请求箱加载中...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="proposal-inbox-page">
      <header className="border-b border-[#F0ECE8] px-6 py-4 dark:border-[#292524] md:px-8 lg:px-10">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">Proposal Inbox</p>
            <h1 className="mt-1 text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">请求箱</h1>
            <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
              Agent 的操作先进入请求箱，再由你决定批准、拒绝还是暂缓。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void loadProposals({ silent: true });
            }}
            disabled={refreshing}
            className="gap-2 rounded-full"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
            刷新
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+96px)] pt-4 md:px-8 md:pb-24 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-4">
          {endpointMissing ? (
            <section className="rounded-3xl border border-dashed border-[#F5C7B8] bg-[#FFF7ED] px-5 py-5 dark:border-[#7C2D12] dark:bg-[#1C1917]">
              <h2 className="text-base font-semibold text-[#9A3412] dark:text-[#FDBA74]">
                当前 RT 还没有接入 proposal 端点
              </h2>
              <p className="mt-2 text-sm text-[#9A3412]/80 dark:text-[#FDBA74]/80">
                UI 已经就位，但运行中的 RT 对 `/proposals` 仍返回 404。等 RT 线完成后，刷新这里就能直接连上。
              </p>
              {errorMessage ? (
                <p className="mt-3 text-xs text-[#B45309] dark:text-[#FCD34D]">{errorMessage}</p>
              ) : null}
              <div className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void loadProposals({ silent: true });
                  }}
                  className="rounded-full"
                >
                  再次探测 RT
                </Button>
              </div>
            </section>
          ) : null}

          {!endpointMissing && errorMessage ? (
            <section className="rounded-2xl border border-[#F5C7B8] bg-[#FFF7ED] px-4 py-3 text-sm text-[#9A3412] dark:border-[#7C2D12] dark:bg-[#1C1917] dark:text-[#FDBA74]">
              {errorMessage}
            </section>
          ) : null}

          <div className={cn(isDesktop ? 'grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]' : 'space-y-4')}>
            <aside className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <SummaryStat label="待处理" value={counts.pending} hint="还没决定的请求" />
                <SummaryStat label="审议中" value={counts.in_review} hint="需要继续讨论的提案" />
                <SummaryStat label="已处理" value={counts.handled} hint="已批准 / 拒绝 / 暂缓" />
              </div>

              <section className="rounded-3xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
                <div className="border-b border-[#F0ECE8] px-4 py-4 dark:border-[#292524]">
                  <div className="flex flex-wrap gap-2">
                    {FILTER_OPTIONS.map((option) => {
                      const active = option.key === activeFilter;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setActiveFilter(option.key)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs transition-colors',
                            active
                              ? 'bg-[#C75B3A] font-semibold text-white'
                              : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]',
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={cn('min-h-[240px] overflow-y-auto', isDesktop ? 'max-h-[calc(100dvh-280px)]' : undefined)}>
                  {visibleProposals.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-[#A8A29E] dark:text-[#78716C]">
                      当前筛选下没有提案。
                    </div>
                  ) : (
                    <div className="space-y-2 p-3">
                      {visibleProposals.map((proposal) => {
                        const selected = proposal.id === selectedProposalId;
                        return (
                          <button
                            key={proposal.id}
                            type="button"
                            onClick={() => setSelectedProposalId(proposal.id)}
                            className={cn(
                              'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                              selected
                                ? 'border-[#F5C7B8] bg-[#FFF7ED] shadow-[0_0_0_1px_rgba(199,91,58,0.18)] dark:border-[#7C2D12] dark:bg-[#2A140D]'
                                : 'border-[#E7E5E4] bg-[#FCFBFA] hover:bg-white dark:border-[#292524] dark:bg-[#141210] dark:hover:bg-[#1C1917]',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                                    {proposal.title}
                                  </p>
                                  <ProposalStatusPill status={proposal.status} />
                                </div>
                                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                                  {resolveProposalActionLabel(proposal.actionType)}
                                  {' · '}
                                  {proposal.publisher.name}
                                </p>
                                <p className="mt-2 line-clamp-2 text-xs text-[#A8A29E] dark:text-[#78716C]">
                                  {proposal.body || '（无正文）'}
                                </p>
                              </div>
                              <span className="shrink-0 text-[11px] text-[#A8A29E]">
                                {formatProposalRelativeTime(proposal.updatedAt)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </aside>

            <section className="space-y-4">
              {!selectedProposal ? (
                <div className="rounded-3xl border border-dashed border-[#D6D3D1] bg-[#FCFBFA] px-6 py-16 text-center text-sm text-[#A8A29E] dark:border-[#3A3432] dark:bg-[#141210] dark:text-[#78716C]">
                  从左侧选择一个提案，查看引用、评论和执行动作。
                </div>
              ) : (
                <>
                  <section className="rounded-3xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <ProposalStatusPill status={selectedProposal.status} />
                          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-[11px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                            #{selectedProposal.id}
                          </span>
                        </div>
                        <h2 className="mt-3 text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                          {selectedProposal.title}
                        </h2>
                        <div className="mt-2 grid gap-2 text-sm text-[#78716C] dark:text-[#A8A29E] sm:grid-cols-2">
                          <p>动作：{resolveProposalActionLabel(selectedProposal.actionType)}</p>
                          <p>提交者：{selectedProposal.publisher.name}</p>
                          <p>创建于：{formatProposalAbsoluteTime(selectedProposal.createdAt)}</p>
                          <p>更新于：{formatProposalAbsoluteTime(selectedProposal.updatedAt)}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void saveDraft();
                          }}
                          disabled={submittingKey !== null || !actionParamsDirty || parsedActionParams.error !== null}
                          className="rounded-full"
                        >
                          <ShieldCheck size={14} />
                          保存草稿
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void approveProposal();
                          }}
                          disabled={submittingKey !== null}
                          className="rounded-full bg-[#15803D] text-white hover:bg-[#166534]"
                        >
                          <Send size={14} />
                          批准执行
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void snoozeProposal();
                          }}
                          disabled={submittingKey !== null}
                          className="rounded-full"
                        >
                          <TimerReset size={14} />
                          暂缓
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void rejectProposal();
                          }}
                          disabled={submittingKey !== null}
                          className="rounded-full"
                        >
                          <XCircle size={14} />
                          拒绝
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0D]">
                      <EventMarkdown content={selectedProposal.body || '*（无正文）*'} />
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
                    <h3 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">引用与上下文</h3>
                    {selectedProposal.references.length === 0 ? (
                      <p className="mt-3 text-sm text-[#A8A29E] dark:text-[#78716C]">暂无引用。</p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {selectedProposal.references.map((reference) => (
                          <article
                            key={`${reference.refType}:${reference.id}`}
                            className="rounded-2xl border border-[#E7E5E4] bg-[#FCFBFA] px-4 py-3 dark:border-[#292524] dark:bg-[#120F0D]"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">
                                  {resolveProposalReferenceLabel(reference.refType)}
                                </p>
                                <p className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                                  {reference.displayText}
                                </p>
                                <p className="mt-1 text-xs text-[#A8A29E]">{reference.id}</p>
                              </div>
                              <ProposalReferenceAction reference={reference} />
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-3xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
                    <h3 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">执行参数</h3>
                    <p className="mt-2 text-sm text-[#78716C] dark:text-[#A8A29E]">
                      首版统一用 JSON 编辑。若是 `create_task`，可以直接改任务标题，再决定是否批准。
                    </p>

                    {selectedProposal.actionType === 'create_task' ? (
                      <div className="mt-4 space-y-2">
                        <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                          任务标题
                        </label>
                        <Input
                          value={editableTaskTitle}
                          onChange={(event) => updateEditableTaskTitle(event.target.value)}
                          placeholder="任务标题"
                          className="rounded-2xl"
                        />
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-2">
                      <label className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                        action_params JSON
                      </label>
                      <Textarea
                        value={actionParamsText}
                        onChange={(event) => setActionParamsText(event.target.value)}
                        rows={12}
                        className="font-mono text-xs"
                      />
                      {parsedActionParams.error ? (
                        <p className="text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                          JSON 无效：{parsedActionParams.error}
                        </p>
                      ) : (
                        <p className="text-xs text-[#A8A29E]">
                          {actionParamsDirty ? '参数已修改，保存或批准时会提交新版本。' : '参数与当前提案保持一致。'}
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
                    <div className="flex items-center gap-2">
                      <MessageSquarePlus size={16} className="text-[#78716C]" />
                      <h3 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">评论区</h3>
                    </div>

                    <div className="mt-4 space-y-3">
                      {selectedProposal.comments.length === 0 ? (
                        <p className="text-sm text-[#A8A29E] dark:text-[#78716C]">还没有评论。</p>
                      ) : (
                        selectedProposal.comments.map((comment) => (
                          <article
                            key={`${comment.author.id}-${comment.createdAt}-${comment.content.slice(0, 12)}`}
                            className="rounded-2xl border border-[#E7E5E4] bg-[#FCFBFA] px-4 py-3 dark:border-[#292524] dark:bg-[#120F0D]"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                                {comment.author.name}
                              </p>
                              <p className="text-[11px] text-[#A8A29E]">
                                {formatProposalAbsoluteTime(comment.createdAt)}
                              </p>
                            </div>
                            <div className="mt-3 text-sm text-[#57534E] dark:text-[#D6D3D1]">
                              <EventMarkdown content={comment.content} />
                            </div>
                          </article>
                        ))
                      )}
                    </div>

                    <div className="mt-4 space-y-3">
                      <Textarea
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        rows={4}
                        placeholder="补充你的意见，或要求 agent 调整参数..."
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          onClick={() => {
                            void addComment();
                          }}
                          disabled={submittingKey !== null || commentDraft.trim().length === 0}
                          className="rounded-full"
                        >
                          添加评论
                        </Button>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
