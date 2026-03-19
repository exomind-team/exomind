import { ArrowLeft, Ellipsis, NotepadText, Target, Play } from 'lucide-react';
import { Link, useNavigate, useParams, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { TASKS_LAST_PATH_KEY, buildTasksMainSearch } from './task-route-memory';
import { TaskBreadcrumb, type TaskBreadcrumbSegment } from '@/ui/app/components/TaskBreadcrumb';
import { getEventLogService, getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import { isTerminalTaskStatus } from '@/lib/types/task';
import type { TaskNode } from '@/lib/types/task';
import { resolveActiveBlockTaskIds, type ActiveBlockData, type TimeBlock } from '@/lib/types/event';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { getUseMockDataEnabled } from '@/config/mock-data';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';
import { EstimatedTimeEditor } from '@/ui/app/components/EstimatedTimeEditor';
import { Switch } from '@/components/ui/switch';
import {
  buildTaskTimeblockDetailViewModel,
  type TimeblockEventLog,
  type TaskTimeblockDetailViewModel,
  type TimeblockBadge,
  type LinkedBlockItem,
} from './task-timeblock-detail-view';
import {
  buildTaskDependencyView,
  formatDependencyActionError,
  type TaskDependencyViewModel,
} from './task-dependency-view';
import {
  buildTaskDagDetailView,
  type TaskDagDetailView,
} from './task-dag-detail-view';
import type { TaskDagVisibilityState } from '@/lib/task/task-dag-visibility';
import { TimerConfigPanel } from '@/ui/app/components/TimerConfigPanel';
import { useTimerConfig } from '@/ui/app/hooks/useTimerConfig';
import { Pencil } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

type DependencyType = 'soft' | 'hard';
const SOURCE_CONFIG: Record<string, { label: string; to: string }> = {
  dag: { label: 'DAG', to: '/tasks/dag' },
  timeblocks: { label: '时间线', to: '/tasks/timeline' },
  timeline: { label: '时间线', to: '/tasks/timeline' },
};
const TASK_TIMER_AUTO_FILL_STORAGE_KEY = 'exomind:task-timer:auto-fill';

interface TimeblockSourceBackLink {
  to: string;
  search?: Record<string, string>;
  label: string;
  sourceLabel: string;
}

function readTaskTimerAutoFillEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(TASK_TIMER_AUTO_FILL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTaskTimerAutoFillEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(TASK_TIMER_AUTO_FILL_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage failures and keep the preference in-memory only.
  }
}

function resolveAutoTimerConfig(
  estimatedMinutes?: number,
  spentMinutes?: number,
): { mode: 'countup' } | { mode: 'countdown'; minutes: number } | null {
  if (estimatedMinutes == null || spentMinutes == null) {
    return null;
  }

  const remainingMinutes = Math.round(estimatedMinutes - spentMinutes);
  if (remainingMinutes > 0) {
    return { mode: 'countdown', minutes: remainingMinutes };
  }

  return { mode: 'countup' };
}

function buildNowFocusSearch(): Record<string, string> {
  return { tab: 'focus' };
}

const MOBILE_ANCHOR_TARGETS = {
  overview: 'task-detail-overview',
  info: 'task-detail-info',
  timer: 'task-detail-timer',
  root: 'task-detail-root-guidance',
  linked: 'task-detail-linked-blocks',
  timeline: 'task-detail-timeline',
  'ai-summary': 'task-detail-ai-summary',
  plan: 'task-detail-plan-actual',
  dependency: 'task-detail-dependency',
  actions: 'task-detail-actions',
} as const;

type MobileAnchorId = keyof typeof MOBILE_ANCHOR_TARGETS;
type MobileSectionAnchor = {
  id: MobileAnchorId;
  label: string;
};

function badgeClassName(badge: TimeblockBadge): string {
  if (badge.tone === 'success') return 'bg-[#DCFCE7] text-[#15803D]';
  if (badge.tone === 'warning') return 'bg-[#FFF7ED] text-[#C75B3A]';
  if (badge.tone === 'danger') return 'bg-[#FEE2E2] text-[#B91C1C]';
  return 'bg-[#F5F0ED] text-[#78716C]';
}

function toneDotClassName(tone: 'neutral' | 'success' | 'warning' | 'danger'): string {
  if (tone === 'success') return 'bg-[#16A34A]';
  if (tone === 'warning') return 'bg-[#C75B3A]';
  if (tone === 'danger') return 'bg-[#E7000B]';
  return 'bg-[#78716C]';
}

function buildSummaryText(model: TaskTimeblockDetailViewModel): string {
  return [
    `时间块：${model.summary.blockName}`,
    `计划：${model.planActual.planContent}`,
    `实际：${model.planActual.actualContent}`,
    `差异：${model.planActual.diffReason}`,
    `AI 产出：${model.aiSummary.keyOutput}`,
    `阻塞：${model.aiSummary.blocker}`,
    `建议：${model.aiSummary.suggestion}`,
  ].join('\n');
}

function selectReviewMarkdown(task: TaskNode, blockName: string, events: Array<{ type?: string; content: string }>): string {
  const feedbackEvents = events.filter((event) => event.type === 'agent_feedback');
  if (feedbackEvents.length === 0) return '';

  const preferred = feedbackEvents.find((event) => event.content.includes(task.title) || event.content.includes(blockName));
  return preferred?.content ?? feedbackEvents[0].content;
}

const EVENT_TYPE_PRIORITY = [
  'block_start',
  'block_pause',
  'block_resume',
  'block_end',
  'block_feedback',
  'agent_feedback',
  'error',
];

function resolveEventTypeFromTags(tags?: Set<string>): string | undefined {
  if (!tags || tags.size === 0) return undefined;
  for (const type of EVENT_TYPE_PRIORITY) {
    if (tags.has(type)) return type;
  }
  return undefined;
}

function resolveEventCreatedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return new Date().toISOString();
  }
  return new Date(timestamp).toISOString();
}

function scrollToMobileAnchor(anchorId: MobileAnchorId): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(MOBILE_ANCHOR_TARGETS[anchorId]);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resolveActiveMobileAnchor(): MobileAnchorId {
  if (typeof document === 'undefined') return 'overview';
  const offset = 132;
  let active: MobileAnchorId = 'overview';
  for (const anchorId of Object.keys(MOBILE_ANCHOR_TARGETS) as MobileAnchorId[]) {
    const element = document.getElementById(MOBILE_ANCHOR_TARGETS[anchorId]);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const hasLayout = rect.height > 0 || rect.bottom > rect.top;
    if (!hasLayout) continue;
    if (rect.top <= offset && rect.bottom >= offset) {
      return anchorId;
    }
    if (rect.top <= offset) {
      active = anchorId;
    }
  }
  return active;
}

function MobileSectionTabs({
  anchors,
  activeAnchorId,
  onSelect,
}: {
  anchors: MobileSectionAnchor[];
  activeAnchorId: MobileAnchorId;
  onSelect: (anchorId: MobileAnchorId) => void;
}) {
  return (
    <div
      data-testid="task-mobile-section-tabs"
      className="sticky top-[57px] z-[9] border-b border-[#F0ECE8] bg-[#FAF7F5]/95 px-4 py-2 backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/95"
    >
      <div role="tablist" aria-label="任务详情分区导航" className="scrollbar-none flex gap-2 overflow-x-auto">
        {anchors.map((anchor) => (
          <button
            key={anchor.id}
            type="button"
            role="tab"
            aria-selected={activeAnchorId === anchor.id}
            aria-controls={MOBILE_ANCHOR_TARGETS[anchor.id]}
            onClick={() => onSelect(anchor.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
              activeAnchorId === anchor.id
                ? 'bg-[#C75B3A] font-semibold text-white'
                : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
            }`}
          >
            {anchor.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function resolvePreferredBlockId(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  const searchParams = new URLSearchParams(window.location.search);
  const fromSearch = searchParams.get('blockId')?.trim();
  if (fromSearch) return fromSearch;

  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get('block')?.trim();
  return fromHash || undefined;
}

function resolveTimeblockSourceBackLink(): TimeblockSourceBackLink {
  if (typeof window === 'undefined') {
    return {
      to: '/tasks',
      label: '← 返回任务',
      sourceLabel: '任务',
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const from = searchParams.get('from')?.trim();
  const sourceConfig = from ? SOURCE_CONFIG[from] : undefined;

  return {
    to: sourceConfig?.to ?? '/tasks',
    label: `← 返回${sourceConfig?.label ?? '任务'}`,
    sourceLabel: sourceConfig?.label ?? '任务',
  };
}

function buildDetailBreadcrumbSegments(backLink: TimeblockSourceBackLink): TaskBreadcrumbSegment[] {
  const segments: TaskBreadcrumbSegment[] = [{ label: '任务', to: '/tasks' }];
  if (backLink.sourceLabel !== '任务') {
    segments.push({
      label: backLink.sourceLabel,
      to: backLink.to,
      search: backLink.search,
    });
  }
  return segments;
}

function buildVirtualTaskFromBlock(block: TimeBlock): TaskNode {
  const estimatedMinutes = Math.max(1, Math.round((block.endTime - block.startTime) / 60_000));
  return {
    id: `timeblock-${block.startId}`,
    title: block.name,
    description: block.note,
    status: 'completed',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    estimatedMinutes,
    timeBlockIds: [block.startId],
    createdAt: block.startTime,
    updatedAt: block.endTime,
    completedAt: block.endTime,
  };
}

function isTaskLinkedToActiveBlock(block: ActiveBlockData | null, taskId: string | undefined): boolean {
  if (!block || !taskId) return false;
  return resolveActiveBlockTaskIds(block).includes(taskId);
}

function DetailActionsCard({
  model,
  onCopySummary,
}: {
  model: TaskTimeblockDetailViewModel;
  onCopySummary: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">其他操作</h3>
      <div className="mt-3 space-y-2">
        {model.actions.map((action) => {
          if (action.id === 'open-task') {
            return (
              <Link
                key={action.id}
                to={action.to!}
                search={action.search}
                className="flex w-full items-center justify-between rounded-xl border border-[#E7E5E4] px-3 py-2 text-sm text-[#44403C] transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#E7E5E4] dark:hover:bg-[#292524]"
              >
                <span>{action.label}</span>
                <span className="text-xs text-[#A8A29E]">打开</span>
              </Link>
            );
          }

          return (
            <button
              key={action.id}
              type="button"
              onClick={onCopySummary}
              className="flex w-full items-center justify-between rounded-xl border border-[#E7E5E4] px-3 py-2 text-left text-sm text-[#44403C] transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#E7E5E4] dark:hover:bg-[#292524]"
            >
              <span>{action.label}</span>
              <span className="text-xs text-[#A8A29E]">复制</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LinkedBlocksCard({
  linkedBlocks,
  taskId,
}: {
  linkedBlocks: LinkedBlockItem[];
  taskId: string;
}) {
  if (linkedBlocks.length === 0) {
    return (
      <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联时间块</h3>
        <p className="mt-2 text-xs text-[#A8A29E]">暂无关联时间块，开始计时后会自动出现。</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联时间块</h3>
      <div className="mt-3 space-y-2">
        {linkedBlocks.map((item) => (
          <Link
            key={item.startId}
            to={`/tasks/${taskId}`}
            search={{ blockId: item.startId }}
            className="block rounded-xl border border-[#E7E5E4] px-3 py-2 transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:hover:bg-[#292524]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.name}</span>
              {item.isActive ? (
                <span className="shrink-0 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-semibold text-[#15803D]">进行中</span>
              ) : (
                <span className="shrink-0 text-xs text-[#A8A29E]">{item.durationLabel}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-[#A8A29E]">{item.startLabel} ~ {item.endLabel}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DependencyCard({
  dependencyView,
  taskDagView,
  selectedTaskId,
  selectedType,
  errorMessage,
  isSaving,
  hideAddDependency,
  onSelectedTaskChange,
  onSelectedTypeChange,
  onAddDependency,
  onChangeDependencyType,
  onRemoveDependency,
  onToggleCollapseUpstream,
  onToggleCollapseDownstream,
}: {
  dependencyView: TaskDependencyViewModel;
  taskDagView: TaskDagDetailView | null;
  selectedTaskId: string;
  selectedType: DependencyType;
  errorMessage: string | null;
  isSaving: boolean;
  hideAddDependency?: boolean;
  onSelectedTaskChange: (value: string) => void;
  onSelectedTypeChange: (value: DependencyType) => void;
  onAddDependency: () => void;
  onChangeDependencyType: (taskId: string, type: DependencyType) => void;
  onRemoveDependency: (taskId: string) => void;
  onToggleCollapseUpstream: (taskId: string) => void;
  onToggleCollapseDownstream: (taskId: string) => void;
}) {
  const selectedCandidate = dependencyView.candidates.find((candidate) => candidate.id === selectedTaskId) ?? null;

  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">依赖关系</h3>
          <p className="mt-1 text-xs text-[#A8A29E]">先完成前置任务，再推进当前任务。</p>
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className="mt-3 rounded-xl bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C] dark:bg-[#3F1D1D] dark:text-[#FECACA]">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {taskDagView ? (
          <div className="rounded-xl bg-[#F8F5F2] p-3 dark:bg-[#292524]" data-testid="task-dag-panel">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">依赖图</h4>
                <p className="mt-1 text-sm text-[#57534E] dark:text-[#D6D3D1]">
                  当前显示 {taskDagView.visibleNodeCount}/{taskDagView.totalNodeCount} 个相关节点
                </p>
              </div>
              <div className="text-xs text-[#78716C] dark:text-[#A8A29E]" data-testid="task-dag-root-summary">
                <p>当前可见根：{taskDagView.visibleCurrentRootTitle ?? '无'}</p>
                <p>
                  真实当前根：
                  {taskDagView.sourceCurrentRootTitle ?? '无'}
                  {taskDagView.sourceCurrentRootTitle && !taskDagView.isSourceCurrentRootVisible ? '（当前已隐藏）' : ''}
                </p>
              </div>
            </div>

            {taskDagView.hiddenNodeCount > 0 ? (
              <p className="mt-2 text-xs text-[#C75B3A] dark:text-[#FDBA74]">
                当前折叠共隐藏 {taskDagView.hiddenNodeCount} 个相关节点。
              </p>
            ) : null}

            {taskDagView.hasCycle ? (
              <p className="mt-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                检测到循环依赖，当前根节点引导按真实图停用，仅展示可见结构。
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              {taskDagView.nodes.map((node) => (
                <article
                  key={node.id}
                  data-testid={`task-dag-node-${node.id}`}
                  className={`rounded-xl bg-white px-3 py-3 dark:bg-[#1C1917] ${
                    node.isCollapsedTarget
                      ? 'border-2 border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:border-[#FDBA74] dark:ring-[#4A2317]'
                      : 'border border-[#E7E5E4] dark:border-[#3F3F46]'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{node.title}</p>
                        <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                          {node.statusLabel}
                        </span>
                        {node.isCurrentTask ? (
                          <span
                            data-testid={`task-dag-badge-current-task-${node.id}`}
                            className="rounded-full bg-[#E0F2FE] px-2 py-0.5 text-[11px] text-[#0369A1] dark:bg-[#172554] dark:text-[#BAE6FD]"
                          >
                            当前任务
                          </span>
                        ) : null}
                        {node.isVisibleRoot ? (
                          <span
                            data-testid={`task-dag-badge-visible-root-${node.id}`}
                            className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] text-[#15803D] dark:bg-[#14532D] dark:text-[#BBF7D0]"
                          >
                            可见根
                          </span>
                        ) : null}
                        {node.isVisibleCurrentRoot ? (
                          <span
                            data-testid={`task-dag-badge-visible-current-root-${node.id}`}
                            className="rounded-full bg-[#FDE68A] px-2 py-0.5 text-[11px] text-[#92400E] dark:bg-[#78350F] dark:text-[#FDE68A]"
                          >
                            当前可见根
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
                        <span>上游节点：{node.upstreamNodeCount}</span>
                        <span>下游节点：{node.downstreamNodeCount}</span>
                        {node.isCollapsedUpstreamTarget ? <span>已折叠上游</span> : null}
                        {node.isCollapsedDownstreamTarget ? <span>已折叠下游</span> : null}
                      </div>

                      {node.hiddenUpstreamCount > 0 ? (
                        <p
                          data-testid={`task-dag-hidden-summary-${node.id}`}
                          className="mt-2 rounded-lg bg-[#FFF7ED] px-2.5 py-1.5 text-xs text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]"
                        >
                          已隐藏 {node.hiddenUpstreamCount} 项
                        </p>
                      ) : null}
                      {node.hiddenDownstreamCount > 0 ? (
                        <p
                          data-testid={`task-dag-hidden-downstream-summary-${node.id}`}
                          className="mt-2 rounded-lg bg-[#ECFDF5] px-2.5 py-1.5 text-xs text-[#047857] dark:bg-[#052E2B] dark:text-[#6EE7B7]"
                        >
                          下游已隐藏 {node.hiddenDownstreamCount} 项
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid={`task-dag-toggle-upstream-${node.id}`}
                        disabled={!node.canCollapseUpstream}
                        onClick={() => onToggleCollapseUpstream(node.id)}
                        className="rounded-xl border border-[#E7E5E4] px-3 py-2 text-sm text-[#57534E] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                      >
                        {node.isCollapsedUpstreamTarget ? '展开上游' : '折叠上游'}
                      </button>
                      <button
                        type="button"
                        data-testid={`task-dag-toggle-downstream-${node.id}`}
                        disabled={!node.canCollapseDownstream}
                        onClick={() => onToggleCollapseDownstream(node.id)}
                        className="rounded-xl border border-[#E7E5E4] px-3 py-2 text-sm text-[#57534E] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                      >
                        {node.isCollapsedDownstreamTarget ? '展开下游' : '折叠下游'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-3">
              <h5 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">可见连线</h5>
              <div className="mt-2 space-y-1">
                {taskDagView.edges.length > 0 ? taskDagView.edges.map((edge) => (
                  <p
                    key={edge.id}
                    data-testid={`task-dag-edge-${edge.id}`}
                    className="rounded-lg bg-white px-2.5 py-2 text-xs text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]"
                  >
                    {edge.sourceTitle} → {edge.targetTitle} · {edge.typeLabel}
                  </p>
                )) : (
                  <p data-testid="task-dag-edges-empty" className="text-xs text-[#A8A29E]">
                    当前可见图中暂无连线
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">前置依赖</h4>
          <div className="mt-2 space-y-2">
            {dependencyView.currentDependencies.length > 0 ? dependencyView.currentDependencies.map((dependency) => (
              <article
                key={dependency.taskId}
                data-testid={`dependency-item-${dependency.taskId}`}
                className="rounded-xl border border-[#E7E5E4] px-3 py-3 dark:border-[#292524]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{dependency.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                        {dependency.statusLabel}
                      </span>
                      {dependency.missing ? (
                        <span className="rounded-full bg-[#FFF7ED] px-2.5 py-1 text-xs text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]">
                          请刷新后确认
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:w-[176px]">
                    <select
                      data-testid={`dependency-type-${dependency.taskId}`}
                      value={dependency.type}
                      disabled={isSaving}
                      onChange={(event) => onChangeDependencyType(dependency.taskId, event.target.value as DependencyType)}
                      className="w-full rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 text-sm text-[#44403C] focus:outline-none focus:ring-2 focus:ring-[#C75B3A]/40 dark:border-[#292524] dark:bg-[#292524] dark:text-[#E7E5E4]"
                    >
                      <option value="soft">soft</option>
                      <option value="hard">hard</option>
                    </select>
                    <button
                      type="button"
                      data-testid={`dependency-remove-${dependency.taskId}`}
                      disabled={isSaving}
                      onClick={() => onRemoveDependency(dependency.taskId)}
                      className="rounded-xl border border-[#E7E5E4] px-3 py-2 text-sm text-[#57534E] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                    >
                      删除依赖
                    </button>
                  </div>
                </div>
              </article>
            )) : (
              <p
                data-testid="dependency-current-empty"
                className="rounded-xl bg-[#F8F5F2] px-3 py-3 text-sm text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
              >
                暂无前置依赖
              </p>
            )}
          </div>
        </div>

        {!hideAddDependency && (
        <div className="rounded-xl bg-[#F8F5F2] p-3 dark:bg-[#292524]">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">新增依赖</h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
            <label className="space-y-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              <span>依赖任务</span>
              <select
                data-testid="dependency-add-task-select"
                value={selectedTaskId}
                disabled={isSaving}
                onChange={(event) => onSelectedTaskChange(event.target.value)}
                className="w-full rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#44403C] focus:outline-none focus:ring-2 focus:ring-[#C75B3A]/40 dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#E7E5E4]"
              >
                <option value="">请选择任务</option>
                {dependencyView.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id} disabled={candidate.disabled}>
                    {candidate.title} · {candidate.statusLabel}{candidate.disabledReason ? ` · ${candidate.disabledReason}` : ''}
                  </option>
                ))}
              </select>
              {selectedCandidate?.disabledReason ? (
                <p
                  data-testid="dependency-add-task-disabled-reason"
                  className="text-[11px] text-[#C75B3A] dark:text-[#FDBA74]"
                >
                  当前候选不可选：{selectedCandidate.disabledReason}
                </p>
              ) : null}
            </label>

            <label className="space-y-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              <span>类型</span>
              <select
                data-testid="dependency-add-type-select"
                value={selectedType}
                disabled={isSaving}
                onChange={(event) => onSelectedTypeChange(event.target.value as DependencyType)}
                className="w-full rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#44403C] focus:outline-none focus:ring-2 focus:ring-[#C75B3A]/40 dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#E7E5E4]"
              >
                <option value="soft">soft</option>
                <option value="hard">hard</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                data-testid="dependency-add-button"
                disabled={isSaving || !selectedTaskId || selectedCandidate?.disabled === true}
                onClick={onAddDependency}
                className="w-full rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
              >
                添加依赖
              </button>
            </div>
          </div>
        </div>
        )}


        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">谁依赖我</h4>
          <div className="mt-2 space-y-2">
            {dependencyView.reverseDependencies.length > 0 ? dependencyView.reverseDependencies.map((dependency) => (
              <article
                key={dependency.taskId}
                data-testid={`reverse-dependency-item-${dependency.taskId}`}
                className="rounded-xl border border-[#E7E5E4] px-3 py-3 dark:border-[#292524]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{dependency.title}</p>
                    <p className="mt-1 text-xs text-[#A8A29E]">状态：{dependency.statusLabel}</p>
                  </div>
                  <span className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                    {dependency.typeLabel}
                  </span>
                </div>
              </article>
            )) : (
              <p className="rounded-xl bg-[#F8F5F2] px-3 py-3 text-sm text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                暂无任务依赖当前任务
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MobileTimeblockDetail({
  descriptionBlock,
  task,
  model,
  backLink,
  dependencyView,
  taskDagView,
  dependencySelectedTaskId,
  dependencySelectedType,
  dependencyError,
  isDependencySaving,
  timerControls,
  autoTimerToggle,
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  blockingReason,
  onStartTimer,
  onAppendTaskToActiveBlock,
  onPauseAndGoEventlog,
  onCopySummary,
  rootGuidance,
  canEditEstimatedTime,
  onEstimatedMinutesUpdate,
  onDependencySelectedTaskChange,
  onDependencySelectedTypeChange,
  onAddDependency,
  onChangeDependencyType,
  onRemoveDependency,
  onToggleCollapseUpstream,
  onToggleCollapseDownstream,
}: {
  descriptionBlock: ReactNode;
  task: TaskNode;
  model: TaskTimeblockDetailViewModel;
  backLink: TimeblockSourceBackLink;
  dependencyView: TaskDependencyViewModel;
  taskDagView: TaskDagDetailView | null;
  dependencySelectedTaskId: string;
  dependencySelectedType: DependencyType;
  dependencyError: string | null;
  isDependencySaving: boolean;
  timerControls: ReactNode;
  autoTimerToggle: ReactNode;
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  blockingReason: string | null;
  onStartTimer: () => void;
  onAppendTaskToActiveBlock: () => void;
  onPauseAndGoEventlog: () => void;
  onCopySummary: () => void;
  rootGuidance?: ReactNode;
  canEditEstimatedTime: boolean;
  onEstimatedMinutesUpdate: (minutes: number | undefined) => void;
  onDependencySelectedTaskChange: (value: string) => void;
  onDependencySelectedTypeChange: (value: DependencyType) => void;
  onAddDependency: () => void;
  onChangeDependencyType: (taskId: string, type: DependencyType) => void;
  onRemoveDependency: (taskId: string) => void;
  onToggleCollapseUpstream: (taskId: string) => void;
  onToggleCollapseDownstream: (taskId: string) => void;
}) {
  const [activeAnchorId, setActiveAnchorId] = useState<MobileAnchorId>('overview');
  const showTimerCard = !isTerminalTaskStatus(task.status);
  const mobileAnchors = useMemo<MobileSectionAnchor[]>(() => {
    const anchors: MobileSectionAnchor[] = [
      { id: 'overview', label: '概览' },
      { id: 'info', label: '信息面板' },
    ];

    if (showTimerCard) {
      anchors.push({ id: 'timer', label: '计时控制' });
    }

    anchors.push(
      { id: 'root', label: '未阻塞节点' },
      { id: 'linked', label: '关联时间块' },
      { id: 'timeline', label: '事件时间线' },
      { id: 'ai-summary', label: 'AI 总结' },
      { id: 'plan', label: '计划 vs 实际' },
      { id: 'dependency', label: '依赖关系' },
      { id: 'actions', label: '操作' },
    );

    return anchors;
  }, [showTimerCard]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncActiveAnchor = () => {
      setActiveAnchorId(resolveActiveMobileAnchor());
    };

    syncActiveAnchor();
    window.addEventListener('scroll', syncActiveAnchor, { passive: true });
    window.addEventListener('resize', syncActiveAnchor);
    return () => {
      window.removeEventListener('scroll', syncActiveAnchor);
      window.removeEventListener('resize', syncActiveAnchor);
    };
  }, []);

  useEffect(() => {
    setActiveAnchorId('overview');
  }, [task.id]);

  const handleSelectAnchor = useCallback((anchorId: MobileAnchorId) => {
    setActiveAnchorId(anchorId);
    scrollToMobileAnchor(anchorId);
  }, []);

  return (
    <div className="scrollbar-none h-full overflow-y-auto bg-[#FAF7F5] pb-10 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#F0ECE8] bg-[#FAF7F5]/95 px-4 py-3 backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/95">
        <Link
          to={backLink.to}
          search={backLink.to === '/tasks' ? buildTasksMainSearch(backLink.search) : backLink.search}
          onClick={() => sessionStorage.removeItem(TASKS_LAST_PATH_KEY)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label={`返回${backLink.sourceLabel}`}
          data-testid="timeblock-back-link-mobile"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务详情</h1>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label="更多操作（More actions）"
        >
          <Ellipsis size={16} />
        </button>
      </header>

      <MobileSectionTabs
        anchors={mobileAnchors}
        activeAnchorId={activeAnchorId}
        onSelect={handleSelectAnchor}
      />

      <div className="space-y-3 px-4 pt-3">
        <section
          id={MOBILE_ANCHOR_TARGETS.overview}
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <div className="flex flex-wrap items-center gap-2">
            {model.summary.badges.map((badge) => (
              <span key={badge.label} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClassName(badge)}`}>
                {badge.label}
              </span>
            ))}
          </div>
          <h2 className="mt-3 text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{model.summary.blockName}</h2>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">关联任务：{task.title}</p>
          {descriptionBlock}
        </section>

        <section
          id={MOBILE_ANCHOR_TARGETS.info}
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">信息面板</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {model.summary.metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
                <p className="text-[11px] text-[#A8A29E]">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        {showTimerCard && (
        <section
          id={MOBILE_ANCHOR_TARGETS.timer}
          data-testid="task-timer-card"
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计时控制</h3>
          {canEditEstimatedTime ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">任务估时</p>
              <div className="mt-1">
                <EstimatedTimeEditor
                  taskId={task.id}
                  currentMinutes={task.estimatedMinutes}
                  onUpdate={onEstimatedMinutesUpdate}
                />
              </div>
            </div>
          ) : null}
          {!hasOtherActiveBlock ? (
            <div className="mt-3">
              {timerControls}
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {hasActiveBlockOnTask ? (
                  <button
                    type="button"
                    onClick={onPauseAndGoEventlog}
                    data-testid="task-pause-button"
                    className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white"
                  >
                    <Target size={14} />
                    回到当下
                  </button>
                ) : hasOtherActiveBlock ? (
                  <>
                    <button
                      type="button"
                      onClick={onAppendTaskToActiveBlock}
                      data-testid="task-append-association-button"
                      className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white"
                    >
                      <Play size={14} />
                      追加任务关联
                    </button>
                    <button
                      type="button"
                      onClick={onPauseAndGoEventlog}
                      data-testid="task-pause-button"
                      className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
                    >
                      <Target size={14} />
                      回到当下
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onStartTimer}
                      disabled={hasOtherActiveBlock || Boolean(blockingReason)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
                    >
                      <Play size={14} />
                      开始计时
                    </button>
                    <button
                      type="button"
                    onClick={onPauseAndGoEventlog}
                    data-testid="task-pause-button"
                    className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
                  >
                    <Target size={14} />
                    回到当下
                  </button>
                  </>
                )}
              </div>
              {!hasOtherActiveBlock ? autoTimerToggle : null}
            </div>
            {blockingReason ? (
              <p className="text-xs text-[#C75B3A] dark:text-[#FDBA74]">{blockingReason}</p>
            ) : hasOtherActiveBlock ? (
              <p className="text-xs text-[#A8A29E]">当前已有时间块进行中，可将本任务追加为关联任务。</p>
            ) : null}
          </div>
        </section>
        )}

        <div id={MOBILE_ANCHOR_TARGETS.root}>
          {rootGuidance}
        </div>

        <div id={MOBILE_ANCHOR_TARGETS.linked}>
          <LinkedBlocksCard linkedBlocks={model.linkedBlocks} taskId={task.id} />
        </div>

        <section
          id={MOBILE_ANCHOR_TARGETS.timeline}
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">事件时间线</h3>
          {model.timeline.items.length === 0 && (task.timeBlockIds ?? []).length === 0 && model.linkedBlocks.length === 0 ? (
            <p className="mt-2 text-xs text-[#A8A29E]">暂无关联时间块，开始一个时间块后即可在此查看事件。</p>
          ) : (
            <div className="mt-3 space-y-3">
              {model.timeline.items.map((item) => (
                <article key={item.id} className="flex gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span className={`h-2 w-2 rounded-full ${toneDotClassName(item.tone)}`} />
                    <span className="mt-1 h-full w-px bg-[#E7E5E4] dark:bg-[#292524]" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <p className="text-xs text-[#A8A29E]">{item.timeLabel}</p>
                    <p className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                    <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          p: ({ ...props }) => <p className="m-0" {...props} />,
                          ul: ({ ...props }) => <ul className="my-1 list-disc pl-4" {...props} />,
                          ol: ({ ...props }) => <ol className="my-1 list-decimal pl-4" {...props} />,
                          li: ({ ...props }) => <li className="my-0" {...props} />,
                          code: ({ className, ...props }) => (
                            <code
                              className={`rounded bg-[#F5F0ED] px-1 py-0.5 dark:bg-[#292524] ${className ?? ''}`}
                              {...props}
                            />
                          ),
                        }}
                      >
                        {item.description}
                      </ReactMarkdown>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          id={MOBILE_ANCHOR_TARGETS['ai-summary']}
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">AI 总结</h3>
          <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.aiSummary.summaryText}</p>
          <div className="mt-3 space-y-2 rounded-xl bg-[#F8F5F2] p-3 dark:bg-[#292524]">
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">关键产出：{model.aiSummary.keyOutput}</p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">阻塞点：{model.aiSummary.blocker}</p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">建议：{model.aiSummary.suggestion}</p>
          </div>
        </section>

        <section
          id={MOBILE_ANCHOR_TARGETS.plan}
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计划 vs 实际</h3>
          <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.planActual.planContent}</p>
          <p className="mt-1 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.planActual.actualContent}</p>
          <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2 text-xs text-[#C75B3A] dark:bg-[#2A231B]">{model.planActual.diffReason}</p>
        </section>

        <div id={MOBILE_ANCHOR_TARGETS.dependency}>
          <DependencyCard
            dependencyView={dependencyView}
            taskDagView={taskDagView}
            selectedTaskId={dependencySelectedTaskId}
            selectedType={dependencySelectedType}
            errorMessage={dependencyError}
            isSaving={isDependencySaving}
            hideAddDependency={isTerminalTaskStatus(task.status)}
            onSelectedTaskChange={onDependencySelectedTaskChange}
            onSelectedTypeChange={onDependencySelectedTypeChange}
            onAddDependency={onAddDependency}
            onChangeDependencyType={onChangeDependencyType}
            onRemoveDependency={onRemoveDependency}
            onToggleCollapseUpstream={onToggleCollapseUpstream}
            onToggleCollapseDownstream={onToggleCollapseDownstream}
          />
        </div>

        <div id={MOBILE_ANCHOR_TARGETS.actions}>
          <DetailActionsCard
            model={model}
            onCopySummary={onCopySummary}
          />
        </div>
      </div>
    </div>
  );
}

function DesktopTimeblockDetail({
  descriptionBlock,
  task,
  model,
  backLink,
  dependencyView,
  taskDagView,
  dependencySelectedTaskId,
  dependencySelectedType,
  dependencyError,
  isDependencySaving,
  timerControls,
  autoTimerToggle,
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  blockingReason,
  onStartTimer,
  onAppendTaskToActiveBlock,
  onPauseAndGoEventlog,
  onCopySummary,
  rootGuidance,
  canEditEstimatedTime,
  onEstimatedMinutesUpdate,
  onDependencySelectedTaskChange,
  onDependencySelectedTypeChange,
  onAddDependency,
  onChangeDependencyType,
  onRemoveDependency,
  onToggleCollapseUpstream,
  onToggleCollapseDownstream,
}: {
  descriptionBlock: ReactNode;
  task: TaskNode;
  model: TaskTimeblockDetailViewModel;
  backLink: TimeblockSourceBackLink;
  dependencyView: TaskDependencyViewModel;
  taskDagView: TaskDagDetailView | null;
  dependencySelectedTaskId: string;
  dependencySelectedType: DependencyType;
  dependencyError: string | null;
  isDependencySaving: boolean;
  timerControls: ReactNode;
  autoTimerToggle: ReactNode;
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  blockingReason: string | null;
  onStartTimer: () => void;
  onAppendTaskToActiveBlock: () => void;
  onPauseAndGoEventlog: () => void;
  onCopySummary: () => void;
  rootGuidance?: ReactNode;
  canEditEstimatedTime: boolean;
  onEstimatedMinutesUpdate: (minutes: number | undefined) => void;
  onDependencySelectedTaskChange: (value: string) => void;
  onDependencySelectedTypeChange: (value: DependencyType) => void;
  onAddDependency: () => void;
  onChangeDependencyType: (taskId: string, type: DependencyType) => void;
  onRemoveDependency: (taskId: string) => void;
  onToggleCollapseUpstream: (taskId: string) => void;
  onToggleCollapseDownstream: (taskId: string) => void;
}) {
  return (
    <div className="scrollbar-none h-full overflow-y-auto bg-[#FAF7F5] px-8 py-6 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <TaskBreadcrumb
        segments={buildDetailBreadcrumbSegments(backLink)}
        current={{ label: '任务详情', icon: NotepadText }}
      />
      <header className="mt-3 rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{model.summary.blockName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {model.summary.badges.map((badge) => (
              <span key={badge.label} className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName(badge)}`}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
        {descriptionBlock}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">信息面板</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
            {model.summary.metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
                <p className="text-xs text-[#A8A29E]">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        {!isTerminalTaskStatus(task.status) && (
        <section
          data-testid="task-timer-card"
          className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计时控制</h3>
          {canEditEstimatedTime ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">任务估时</p>
              <div className="mt-1">
                <EstimatedTimeEditor
                  taskId={task.id}
                  currentMinutes={task.estimatedMinutes}
                  onUpdate={onEstimatedMinutesUpdate}
                />
              </div>
            </div>
          ) : null}
          {!hasOtherActiveBlock ? (
            <div className="mt-3">
              {timerControls}
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {hasActiveBlockOnTask ? (
                  <button
                    type="button"
                    onClick={onPauseAndGoEventlog}
                    data-testid="task-pause-button"
                    className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white"
                  >
                    <Target size={14} />
                    回到当下
                  </button>
                ) : hasOtherActiveBlock ? (
                  <>
                    <button
                      type="button"
                      onClick={onAppendTaskToActiveBlock}
                      data-testid="task-append-association-button"
                      className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white"
                    >
                      <Play size={14} />
                      追加任务关联
                    </button>
                    <button
                      type="button"
                      onClick={onPauseAndGoEventlog}
                      data-testid="task-pause-button"
                      className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
                    >
                      <Target size={14} />
                      回到当下
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onStartTimer}
                      disabled={hasOtherActiveBlock || Boolean(blockingReason)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
                    >
                      <Play size={14} />
                      开始计时
                    </button>
                    <button
                      type="button"
                    onClick={onPauseAndGoEventlog}
                    data-testid="task-pause-button"
                    className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
                  >
                    <Target size={14} />
                    回到当下
                  </button>
                  </>
                )}
              </div>
              {!hasOtherActiveBlock ? autoTimerToggle : null}
            </div>
            {blockingReason ? (
              <p className="text-xs text-[#C75B3A] dark:text-[#FDBA74]">{blockingReason}</p>
            ) : hasOtherActiveBlock ? (
              <p className="text-xs text-[#A8A29E]">当前已有时间块进行中，可将本任务追加为关联任务。</p>
            ) : null}
          </div>
        </section>
        )}
      </div>

      <section className="mt-4 grid grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="space-y-3">
          <LinkedBlocksCard linkedBlocks={model.linkedBlocks} taskId={task.id} />

          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">事件时间线</h3>
            {model.timeline.items.length === 0 && (task.timeBlockIds ?? []).length === 0 && model.linkedBlocks.length === 0 ? (
              <p className="mt-2 text-xs text-[#A8A29E]">暂无关联时间块，开始一个时间块后即可在此查看事件。</p>
            ) : (
              <div className="mt-4 space-y-3">
                {model.timeline.items.map((item) => (
                  <article key={item.id} className="flex gap-3">
                    <span className={`mt-1 h-2 w-2 rounded-full ${toneDotClassName(item.tone)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                        <p className="text-xs text-[#A8A29E]">{item.timeLabel}</p>
                      </div>
                      <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={{
                            p: ({ ...props }) => <p className="m-0" {...props} />,
                            ul: ({ ...props }) => <ul className="my-1 list-disc pl-4" {...props} />,
                            ol: ({ ...props }) => <ol className="my-1 list-decimal pl-4" {...props} />,
                            li: ({ ...props }) => <li className="my-0" {...props} />,
                            code: ({ className, ...props }) => (
                              <code
                                className={`rounded bg-[#F5F0ED] px-1 py-0.5 dark:bg-[#292524] ${className ?? ''}`}
                                {...props}
                              />
                            ),
                          }}
                        >
                          {item.description}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          {rootGuidance}

          <DependencyCard
            dependencyView={dependencyView}
            taskDagView={taskDagView}
            selectedTaskId={dependencySelectedTaskId}
            selectedType={dependencySelectedType}
            errorMessage={dependencyError}
            isSaving={isDependencySaving}
            hideAddDependency={isTerminalTaskStatus(task.status)}
            onSelectedTaskChange={onDependencySelectedTaskChange}
            onSelectedTypeChange={onDependencySelectedTypeChange}
            onAddDependency={onAddDependency}
            onChangeDependencyType={onChangeDependencyType}
            onRemoveDependency={onRemoveDependency}
            onToggleCollapseUpstream={onToggleCollapseUpstream}
            onToggleCollapseDownstream={onToggleCollapseDownstream}
          />

          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计划 vs 实际</h3>
            <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">{model.planActual.planContent}</p>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{model.planActual.actualContent}</p>
            <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2 text-xs text-[#C75B3A] dark:bg-[#2A231B]">{model.planActual.diffReason}</p>
          </section>

          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">AI 总结</h3>
            <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">{model.aiSummary.summaryText}</p>
            <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">关键产出：{model.aiSummary.keyOutput}</p>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">阻塞点：{model.aiSummary.blocker}</p>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">建议：{model.aiSummary.suggestion}</p>
          </section>

          <DetailActionsCard
            model={model}
            onCopySummary={onCopySummary}
          />
        </aside>
      </section>
    </div>
  );
}

export function TaskDetailPage() {
  const { taskId, blockId: blockIdParam } = useParams({ strict: false }) as { taskId?: string; blockId?: string };
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const preferredBlockId = blockIdParam || resolvePreferredBlockId();
  const backLink = resolveTimeblockSourceBackLink();

  // Persist current tasks sub-path for nav tab memory
  useEffect(() => {
    const fullPath = location.pathname + (location.searchStr || '');
    if (fullPath.startsWith('/tasks/')) {
      sessionStorage.setItem(TASKS_LAST_PATH_KEY, fullPath);
    }
  }, [location.pathname, location.searchStr]);

  const [task, setTask] = useState<TaskNode | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [hasOtherActiveBlock, setHasOtherActiveBlock] = useState(false);
  const [spentMinutes, setSpentMinutes] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewMarkdown, setReviewMarkdown] = useState('');
  const [eventLogs, setEventLogs] = useState<TimeblockEventLog[]>([]);
  const [allTasks, setAllTasks] = useState<TaskNode[]>([]);
  const [dependencySelectedTaskId, setDependencySelectedTaskId] = useState('');
  const [dependencySelectedType, setDependencySelectedType] = useState<DependencyType>('soft');
  const [dagVisibilityState, setDagVisibilityState] = useState<TaskDagVisibilityState>({
    collapsedUpstreamOf: [],
    collapsedDownstreamOf: [],
  });
  const [dependencyLoadError, setDependencyLoadError] = useState<string | null>(null);
  const [dependencyActionError, setDependencyActionError] = useState<string | null>(null);
  const [isDependencySaving, setIsDependencySaving] = useState(false);
  const [dependencyReloadKey, setDependencyReloadKey] = useState(0);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isTimerAutoFillEnabled, setIsTimerAutoFillEnabled] = useState(() => readTaskTimerAutoFillEnabled());
  const timerResetKey = taskId ?? preferredBlockId ?? task?.id;
  const taskEstimatedMinutes = taskId
    ? task?.id === taskId ? task.estimatedMinutes : undefined
    : task?.estimatedMinutes;
  const autoTimerConfig = useMemo(
    () => resolveAutoTimerConfig(taskEstimatedMinutes, spentMinutes),
    [spentMinutes, taskEstimatedMinutes],
  );
  const timerInitialMinutes = useMemo(() => {
    if (isTimerAutoFillEnabled) {
      if (autoTimerConfig?.mode === 'countdown') {
        return autoTimerConfig.minutes;
      }

      if (autoTimerConfig?.mode === 'countup') {
        return undefined;
      }
    }

    return taskEstimatedMinutes;
  }, [autoTimerConfig, isTimerAutoFillEnabled, taskEstimatedMinutes]);
  const {
    timerMode,
    countdownMinutes,
    setTimerMode,
    setCountdownMinutes,
    syncTimerConfig,
    customDurationDraft,
    setCustomDurationDraft,
    commitCustomDuration,
    timerConfig,
  } = useTimerConfig(timerInitialMinutes, timerResetKey);

  useEffect(() => {
    writeTaskTimerAutoFillEnabled(isTimerAutoFillEnabled);
  }, [isTimerAutoFillEnabled]);

  useEffect(() => {
    if (!isTimerAutoFillEnabled || !autoTimerConfig) {
      return;
    }

    syncTimerConfig(autoTimerConfig);
  }, [autoTimerConfig, isTimerAutoFillEnabled, syncTimerConfig]);

  useLayoutEffect(() => {
    setIsLoading(true);
    setTask(null);
    setActiveBlock(null);
    setHasOtherActiveBlock(false);
    setSpentMinutes(undefined);
    setEventLogs([]);
    setReviewMarkdown('');
  }, [dependencyReloadKey, preferredBlockId, taskId]);

  useEffect(() => {
    setDagVisibilityState({
      collapsedUpstreamOf: [],
      collapsedDownstreamOf: [],
    });
  }, [task?.id]);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();
    const load = async () => {
      if (!taskId && !preferredBlockId) {
        setAllTasks([]);
        setDependencyLoadError(null);
        setIsLoading(false);
        return;
      }

      const listedTasksPromise = taskService.listTasks(true)
        .then((tasks) => {
          if (!disposed) setDependencyLoadError(null);
          return tasks;
        })
        .catch((error) => {
          if (!disposed) setDependencyLoadError(formatDependencyActionError(error, 'load'));
          return [] as TaskNode[];
        });

      const [loadedTask, blocks, currentBlock, listedTasks] = await Promise.all([
        taskId ? taskService.getTask(taskId) : Promise.resolve(null),
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
        listedTasksPromise,
      ]);
      let nextTask = loadedTask;
      if (!nextTask && preferredBlockId) {
        const matchedBlock = blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId);
        if (matchedBlock) {
          const linked = listedTasks.find((candidate) => (candidate.timeBlockIds ?? []).includes(matchedBlock.startId));
          nextTask = linked ?? buildVirtualTaskFromBlock(matchedBlock);
        }
      }
      if (!nextTask) {
        nextTask = listedTasks[0] ?? null;
      }

      if (disposed) return;
      setTask(nextTask);
      setAllTasks(listedTasks);
      setTimeBlocks(blocks);
      setActiveBlock(nextTask && isTaskLinkedToActiveBlock(currentBlock, nextTask.id) ? currentBlock : null);
      setHasOtherActiveBlock(Boolean(currentBlock && nextTask && !isTaskLinkedToActiveBlock(currentBlock, nextTask.id)));

      if (nextTask) {
        const [events, calculatedSpentMinutes] = await Promise.all([
          getEventLogService().loadEvents(),
          getTaskTimerService().calculateSpentMinutes(nextTask.id).catch(() => 0),
        ]);
        const matchedBlockName = preferredBlockId
          ? blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId)?.name
          : undefined;
        if (!disposed) {
          const normalizedEvents = events.map((event) => ({
            id: event.id,
            createdAt: resolveEventCreatedAt(event.timestamp),
            content: event.content,
            type: resolveEventTypeFromTags(event.tags),
          }));
          setSpentMinutes(calculatedSpentMinutes);
          setEventLogs(normalizedEvents);
          setReviewMarkdown(selectReviewMarkdown(nextTask, matchedBlockName ?? nextTask.title, normalizedEvents));
        }
      } else {
        setSpentMinutes(undefined);
        setEventLogs([]);
        setReviewMarkdown('');
      }
      if (!disposed) setIsLoading(false);
    };

    void load();
    const unsubscribeTasks = taskService.onTaskChange(() => {
      void load();
    });
    const unsubscribeBlocks = timeBlockService.onBlockChange(() => {
      void load();
    });

    return () => {
      disposed = true;
      unsubscribeTasks();
      unsubscribeBlocks();
    };
  }, [dependencyReloadKey, preferredBlockId, taskId]);

  const viewModel = useMemo(() => {
    if (!task) return null;
    return buildTaskTimeblockDetailViewModel({
      task,
      blocks: timeBlocks,
      activeBlock,
      preferredBlockId,
      eventLogs,
      reviewMarkdown,
      useMockData: getUseMockDataEnabled(),
    });
  }, [activeBlock, eventLogs, preferredBlockId, reviewMarkdown, task, timeBlocks]);

  const taskGraph = useMemo(() => buildTaskGraph(allTasks), [allTasks]);
  const taskById = useMemo(() => new Map(allTasks.map((candidate) => [candidate.id, candidate])), [allTasks]);
  const rootGuidance = useMemo(() => (
    <TaskCurrentRootCard graph={taskGraph} taskById={taskById} currentTaskId={task?.id} collapsible={true} />
  ), [task?.id, taskById, taskGraph]);
  const canEditEstimatedTime = useMemo(
    () => (task ? allTasks.some((candidate) => candidate.id === task.id) && !isTerminalTaskStatus(task.status) : false),
    [allTasks, task],
  );
  const blockingReason = useMemo(() => {
    if (!task) return null;
    const reasons: string[] = [];
    const incompleteHardDeps = task.dependsOn
      .filter((dep) => dep.type === 'hard')
      .map((dep) => {
        const predecessor = taskById.get(dep.taskId);
        if (!predecessor || predecessor.status === 'completed') return null;
        return predecessor.title;
      })
      .filter((title): title is string => title !== null);
    if (incompleteHardDeps.length > 0) {
      reasons.push(`硬依赖未完成：${incompleteHardDeps.join('、')}`);
    }
    const pendingSoftDeps = task.dependsOn
      .filter((dep) => dep.type === 'soft')
      .map((dep) => {
        const predecessor = taskById.get(dep.taskId);
        if (!predecessor || predecessor.status !== 'pending') return null;
        return predecessor.title;
      })
      .filter((title): title is string => title !== null);
    if (pendingSoftDeps.length > 0) {
      reasons.push(pendingSoftDeps.map((title) => `软依赖「${title}」尚未开始`).join('、'));
    }
    if (reasons.length === 0) return null;
    return reasons.join('；');
  }, [task, taskById]);
  const timerControls = (
    <TimerConfigPanel
      timerMode={timerMode}
      countdownMinutes={countdownMinutes}
      setTimerMode={setTimerMode}
      setCountdownMinutes={setCountdownMinutes}
      customDurationDraft={customDurationDraft}
      setCustomDurationDraft={setCustomDurationDraft}
      commitCustomDuration={commitCustomDuration}
      showCountupOption
    />
  );
  const autoTimerStatusText = taskEstimatedMinutes == null
    ? '未设估时'
    : spentMinutes == null
      ? '等待时间块统计'
      : autoTimerConfig?.mode === 'countdown'
        ? `剩余 ${autoTimerConfig.minutes}min`
        : '已超预期，自动正计时';
  const autoTimerToggle = (
    <label
      data-testid="task-countdown-auto-fill-toggle"
      className="ml-auto inline-flex items-center gap-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#0C0A09]"
    >
      <div className="text-right">
        <p className="text-[11px] font-medium text-[#57534E] dark:text-[#D6D3D1]">自动补全</p>
        <p data-testid="task-countdown-auto-fill-status" className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
          {autoTimerStatusText}
        </p>
      </div>
      <Switch
        checked={isTimerAutoFillEnabled}
        onCheckedChange={setIsTimerAutoFillEnabled}
        disabled={taskEstimatedMinutes == null || spentMinutes == null}
        aria-label="自动补全计时时长"
        data-testid="task-countdown-auto-fill-switch"
      />
    </label>
  );

  const dependencyView = useMemo(() => {
    if (!task) return null;
    return buildTaskDependencyView(task, allTasks);
  }, [allTasks, task]);

  const taskDagView = useMemo(() => {
    if (!task) return null;
    return buildTaskDagDetailView(task, allTasks, dagVisibilityState);
  }, [allTasks, dagVisibilityState, task]);

  const dependencyError = dependencyActionError ?? dependencyLoadError;

  const reloadDependencies = () => {
    setDependencyReloadKey((value) => value + 1);
  };

  const handleToggleCollapseUpstream = (targetTaskId: string) => {
    setDagVisibilityState((currentState) => ({
      ...currentState,
      collapsedUpstreamOf: currentState.collapsedUpstreamOf.includes(targetTaskId)
        ? currentState.collapsedUpstreamOf.filter((taskId) => taskId !== targetTaskId)
        : [...currentState.collapsedUpstreamOf, targetTaskId],
    }));
  };

  const handleToggleCollapseDownstream = (targetTaskId: string) => {
    setDagVisibilityState((currentState) => ({
      ...currentState,
      collapsedDownstreamOf: currentState.collapsedDownstreamOf.includes(targetTaskId)
        ? currentState.collapsedDownstreamOf.filter((taskId) => taskId !== targetTaskId)
        : [...currentState.collapsedDownstreamOf, targetTaskId],
    }));
  };

  const handleAddDependency = async () => {
    if (!task || !dependencyView) return;

    setDependencyActionError(null);
    if (!dependencySelectedTaskId) {
      setDependencyActionError('请选择依赖任务');
      return;
    }
    const selectedCandidate = dependencyView.candidates.find((candidate) => candidate.id === dependencySelectedTaskId);
    if (!selectedCandidate) {
      setDependencyActionError('依赖任务不存在，请刷新后重试');
      return;
    }
    if (selectedCandidate.disabled) {
      setDependencyActionError(`该依赖不可选：${selectedCandidate.disabledReason ?? '请更换其他任务'}`);
      return;
    }

    setIsDependencySaving(true);
    try {
      const updated = await getTaskService().addDependency(task.id, dependencySelectedTaskId, dependencySelectedType);
      if (!updated) {
        setDependencyActionError('当前任务不存在，依赖未保存');
        return;
      }
      setDependencySelectedTaskId('');
      setDependencySelectedType('soft');
      reloadDependencies();
    } catch (error) {
      setDependencyActionError(formatDependencyActionError(error, 'add'));
    } finally {
      setIsDependencySaving(false);
    }
  };

  const handleChangeDependencyType = async (depTaskId: string, type: DependencyType) => {
    if (!task) return;

    setDependencyActionError(null);
    setIsDependencySaving(true);
    try {
      const updated = await getTaskService().addDependency(task.id, depTaskId, type);
      if (!updated) {
        setDependencyActionError('当前任务不存在，依赖未更新');
        return;
      }
      reloadDependencies();
    } catch (error) {
      setDependencyActionError(formatDependencyActionError(error, 'update'));
    } finally {
      setIsDependencySaving(false);
    }
  };

  const handleRemoveDependency = async (depTaskId: string) => {
    if (!task) return;

    setDependencyActionError(null);
    setIsDependencySaving(true);
    try {
      const updated = await getTaskService().removeDependency(task.id, depTaskId);
      if (!updated) {
        setDependencyActionError('当前任务不存在，依赖未删除');
        return;
      }
      reloadDependencies();
    } catch (error) {
      setDependencyActionError(formatDependencyActionError(error, 'remove'));
    } finally {
      setIsDependencySaving(false);
    }
  };

  const handleStartTimer = () => {
    if (!taskId) { console.error('[TaskDetail] handleStartTimer: no taskId'); return; }
    console.log('[TaskDetail] handleStartTimer', { taskId, timerConfig, timerMode, countdownMinutes });
    void getTaskTimerService().startBlockForTask(taskId, timerConfig).then((block) => {
      console.log('[TaskDetail] startBlockForTask OK', block ? { startId: block.startId, mode: block.mode, phase: block.phase, taskIds: resolveActiveBlockTaskIds(block), paused: block.paused, elapsed: block.elapsed } : 'NULL');
      void navigate({ to: '/eventlog', search: buildNowFocusSearch() });
    }).catch((err) => {
      console.error('[TaskDetail] startBlockForTask FAILED', err);
    });
  };

  const handleAppendTaskToActiveBlock = () => {
    if (!taskId) return;
    void getTaskTimerService().addTaskToBlock(taskId).then(() => {
      void navigate({ to: '/eventlog', search: buildNowFocusSearch() });
    }).catch((err) => {
      console.error('[TaskDetail] addTaskToBlock FAILED', err);
    });
  };

  const handlePauseAndGoEventlog = () => {
    if (!activeBlock) {
      void navigate({ to: '/eventlog', search: buildNowFocusSearch() });
      return;
    }
    void getTimeBlockService().pauseBlock().finally(() => {
      void navigate({ to: '/eventlog', search: buildNowFocusSearch() });
    });
  };

  const handleCopySummary = () => {
    if (!viewModel) return;
    const text = buildSummaryText(viewModel);
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
  };

  const handleEstimatedMinutesUpdate = useCallback((minutes: number | undefined) => {
    const sourceTaskId = task?.id;
    if (!sourceTaskId) return;

    const updatedAt = Date.now();
    const nextAutoTimerConfig = resolveAutoTimerConfig(minutes, spentMinutes);
    if (isTimerAutoFillEnabled && nextAutoTimerConfig) {
      syncTimerConfig(nextAutoTimerConfig);
    } else if (minutes == null) {
      setTimerMode('countup');
    } else {
      setCountdownMinutes(minutes);
    }
    setTask((current) => {
      if (!current || current.id !== sourceTaskId) return current;
      return {
        ...current,
        estimatedMinutes: minutes,
        updatedAt,
      };
    });
    setAllTasks((current) => current.map((candidate) => (
      candidate.id === sourceTaskId
        ? {
            ...candidate,
            estimatedMinutes: minutes,
            updatedAt,
          }
        : candidate
    )));
  }, [isTimerAutoFillEnabled, setCountdownMinutes, setTimerMode, spentMinutes, syncTimerConfig, task?.id]);

  const handleSaveDescription = useCallback(async () => {
    if (!task?.id) return;
    const trimmed = descriptionDraft.trim() || undefined;
    setIsEditingDescription(false);
    setTask((current) => current ? { ...current, description: trimmed } : current);
    await getTaskService().updateTask(task.id, { description: trimmed ?? '' });
  }, [task?.id, descriptionDraft]);

  const handleCancelDescription = useCallback(() => {
    setDescriptionDraft(task?.description ?? '');
    setIsEditingDescription(false);
  }, [task?.description]);

  if (isLoading) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <p className="text-sm text-[#A8A29E]">加载中...</p>
      </div>
    );
  }

  if (!task || !viewModel || !dependencyView) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <Link
          to={backLink.to}
          search={backLink.to === '/tasks' ? buildTasksMainSearch(backLink.search) : backLink.search}
          className="inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]"
        >
          <ArrowLeft size={16} />
          {backLink.label.replace('← ', '')}
        </Link>
        <p className="mt-3 text-sm text-[#A8A29E]">任务不存在</p>
      </div>
    );
  }

  const descriptionBlock = (
    <>
      {isEditingDescription ? (
        <div className="mt-3">
          <Textarea
            autoFocus
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelDescription();
                return;
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSaveDescription();
              }
            }}
            placeholder="输入任务描述..."
            className="min-h-[120px] border-none bg-transparent p-0 text-sm text-[#1C1917] shadow-none focus-visible:ring-0 dark:text-[#FAFAF9]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={handleCancelDescription} className="rounded-lg px-3 py-1 text-xs text-[#78716C] hover:bg-[#F5F0ED] dark:hover:bg-[#292524]">取消</button>
            <button type="button" onClick={handleSaveDescription} className="rounded-lg bg-[#1C1917] px-3 py-1 text-xs text-white dark:bg-[#FAFAF9] dark:text-[#1C1917]">保存</button>
          </div>
        </div>
      ) : task.description ? (
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-[#78716C] dark:text-[#A8A29E] prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 prose-headings:text-[#44403C] dark:prose-headings:text-[#D6D3D1] prose-a:text-[#C75B3A] prose-code:text-[#78716C] dark:prose-code:text-[#A8A29E] prose-pre:bg-[#F5F0ED] dark:prose-pre:bg-[#292524]">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{task.description}</ReactMarkdown>
          </div>
          {!isTerminalTaskStatus(task.status) && (
            <button type="button" onClick={() => { setDescriptionDraft(task.description ?? ''); setIsEditingDescription(true); }} className="shrink-0 rounded-lg p-1.5 text-[#A8A29E] hover:bg-[#F5F0ED] dark:hover:bg-[#292524]">
              <Pencil size={14} />
            </button>
          )}
        </div>
      ) : !isTerminalTaskStatus(task.status) ? (
        <button type="button" onClick={() => { setDescriptionDraft(''); setIsEditingDescription(true); }} className="mt-3 text-sm text-[#A8A29E] hover:text-[#78716C] dark:hover:text-[#D6D3D1]">
          + 添加任务描述
        </button>
      ) : null}
    </>
  );

  if (isDesktop) {
    return (
      <DesktopTimeblockDetail
        descriptionBlock={descriptionBlock}
        task={task}
        model={viewModel}
        backLink={backLink}
        dependencyView={dependencyView}
        taskDagView={taskDagView}
        dependencySelectedTaskId={dependencySelectedTaskId}
        dependencySelectedType={dependencySelectedType}
        dependencyError={dependencyError}
        isDependencySaving={isDependencySaving}
        timerControls={timerControls}
        autoTimerToggle={autoTimerToggle}
        hasOtherActiveBlock={hasOtherActiveBlock}
        hasActiveBlockOnTask={Boolean(activeBlock)}
        blockingReason={blockingReason}
        onStartTimer={handleStartTimer}
        onAppendTaskToActiveBlock={handleAppendTaskToActiveBlock}
        onPauseAndGoEventlog={handlePauseAndGoEventlog}
        onCopySummary={handleCopySummary}
        rootGuidance={rootGuidance}
        canEditEstimatedTime={canEditEstimatedTime}
        onEstimatedMinutesUpdate={handleEstimatedMinutesUpdate}
        onDependencySelectedTaskChange={setDependencySelectedTaskId}
        onDependencySelectedTypeChange={setDependencySelectedType}
        onAddDependency={handleAddDependency}
        onChangeDependencyType={handleChangeDependencyType}
        onRemoveDependency={handleRemoveDependency}
        onToggleCollapseUpstream={handleToggleCollapseUpstream}
        onToggleCollapseDownstream={handleToggleCollapseDownstream}
      />
    );
  }

  return (
    <MobileTimeblockDetail
      descriptionBlock={descriptionBlock}
      task={task}
      model={viewModel}
      backLink={backLink}
      dependencyView={dependencyView}
      taskDagView={taskDagView}
      dependencySelectedTaskId={dependencySelectedTaskId}
      dependencySelectedType={dependencySelectedType}
      dependencyError={dependencyError}
      isDependencySaving={isDependencySaving}
      timerControls={timerControls}
      autoTimerToggle={autoTimerToggle}
      hasOtherActiveBlock={hasOtherActiveBlock}
      hasActiveBlockOnTask={Boolean(activeBlock)}
      blockingReason={blockingReason}
      onStartTimer={handleStartTimer}
      onAppendTaskToActiveBlock={handleAppendTaskToActiveBlock}
      onPauseAndGoEventlog={handlePauseAndGoEventlog}
      onCopySummary={handleCopySummary}
      rootGuidance={rootGuidance}
      canEditEstimatedTime={canEditEstimatedTime}
      onEstimatedMinutesUpdate={handleEstimatedMinutesUpdate}
      onDependencySelectedTaskChange={setDependencySelectedTaskId}
      onDependencySelectedTypeChange={setDependencySelectedType}
      onAddDependency={handleAddDependency}
      onChangeDependencyType={handleChangeDependencyType}
      onRemoveDependency={handleRemoveDependency}
      onToggleCollapseUpstream={handleToggleCollapseUpstream}
      onToggleCollapseDownstream={handleToggleCollapseDownstream}
    />
  );
}
