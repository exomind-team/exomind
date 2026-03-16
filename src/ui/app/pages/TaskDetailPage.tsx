import { ArrowLeft, Ellipsis, Pause, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import { isTerminalTaskStatus } from '@/lib/types/task';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import { getEventStorage } from '@/lib/storage/event-storage';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { getUseMockDataEnabled } from '@/config/mock-data';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';
import { EstimatedTimeEditor } from '@/ui/app/components/EstimatedTimeEditor';
import {
  buildTaskTimeblockDetailViewModel,
  type TimeblockEventLog,
  type TaskTimeblockDetailViewModel,
  type TimeblockBadge,
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

type DependencyType = 'soft' | 'hard';
type TimeblockSourceTab = 'now' | 'today' | 'week' | 'month';

const TIMEBLOCK_SOURCE_LABEL: Record<TimeblockSourceTab, string> = {
  now: '当下',
  today: '今日',
  week: '一周',
  month: '本月',
};

function isTimeblockSourceTab(value: string): value is TimeblockSourceTab {
  return Object.prototype.hasOwnProperty.call(TIMEBLOCK_SOURCE_LABEL, value);
}

interface TimeblockSourceBackLink {
  to: string;
  search?: Record<string, string>;
  label: string;
  sourceLabel: string;
}

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
  const sourceTab = from && isTimeblockSourceTab(from) ? from : undefined;
  const sourceLabel = sourceTab ? TIMEBLOCK_SOURCE_LABEL[sourceTab] : '任务';

  return {
    to: '/tasks',
    search: sourceTab ? { tab: sourceTab } : undefined,
    label: `← 返回${sourceLabel}`,
    sourceLabel,
  };
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

function DetailActionsCard({
  model,
  onRestart,
  onCopySummary,
}: {
  model: TaskTimeblockDetailViewModel;
  onRestart: () => void;
  onCopySummary: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">操作</h3>
      <div className="mt-3 space-y-2">
        {model.actions.map((action) => {
          if (action.id === 'open-task' || action.id === 'open-eventlog') {
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
              onClick={action.id === 'restart' ? onRestart : onCopySummary}
              className="flex w-full items-center justify-between rounded-xl border border-[#E7E5E4] px-3 py-2 text-left text-sm text-[#44403C] transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#E7E5E4] dark:hover:bg-[#292524]"
            >
              <span>{action.label}</span>
              <span className="text-xs text-[#A8A29E]">{action.id === 'restart' ? '执行' : '复制'}</span>
            </button>
          );
        })}
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
  onSelectedTaskChange,
  onSelectedTypeChange,
  onAddDependency,
  onChangeDependencyType,
  onRemoveDependency,
  onToggleCollapseUpstream,
}: {
  dependencyView: TaskDependencyViewModel;
  taskDagView: TaskDagDetailView | null;
  selectedTaskId: string;
  selectedType: DependencyType;
  errorMessage: string | null;
  isSaving: boolean;
  onSelectedTaskChange: (value: string) => void;
  onSelectedTypeChange: (value: DependencyType) => void;
  onAddDependency: () => void;
  onChangeDependencyType: (taskId: string, type: DependencyType) => void;
  onRemoveDependency: (taskId: string) => void;
  onToggleCollapseUpstream: (taskId: string) => void;
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
                当前折叠共隐藏 {taskDagView.hiddenNodeCount} 个上游节点。
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
                  className="rounded-xl border border-[#E7E5E4] bg-white px-3 py-3 dark:border-[#3F3F46] dark:bg-[#1C1917]"
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
                        {node.isCollapsedTarget ? <span>已折叠上游</span> : null}
                      </div>

                      {node.hiddenUpstreamCount > 0 ? (
                        <p
                          data-testid={`task-dag-hidden-summary-${node.id}`}
                          className="mt-2 rounded-lg bg-[#FFF7ED] px-2.5 py-1.5 text-xs text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]"
                        >
                          已隐藏 {node.hiddenUpstreamCount} 项
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      data-testid={`task-dag-toggle-upstream-${node.id}`}
                      disabled={!node.canCollapseUpstream}
                      onClick={() => onToggleCollapseUpstream(node.id)}
                      className="rounded-xl border border-[#E7E5E4] px-3 py-2 text-sm text-[#57534E] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                    >
                      {node.isCollapsedTarget ? '展开上游' : '折叠上游'}
                    </button>
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
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  onStartTimer,
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
}: {
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
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  onStartTimer: () => void;
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
}) {
  return (
    <div className="min-h-full bg-[#FAF7F5] pb-10 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#F0ECE8] bg-[#FAF7F5]/95 px-4 py-3 backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/95">
        <Link
          to={backLink.to}
          search={backLink.search}
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

      <div className="space-y-3 px-4 pt-3">
        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="flex flex-wrap items-center gap-2">
            {model.summary.badges.map((badge) => (
              <span key={badge.label} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClassName(badge)}`}>
                {badge.label}
              </span>
            ))}
          </div>
          <h2 className="mt-3 text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{model.summary.blockName}</h2>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">关联任务：{task.title}</p>
          {task.description ? (
            <p className="mt-2 whitespace-pre-wrap text-xs text-[#78716C] dark:text-[#A8A29E]">{task.description}</p>
          ) : null}
          {canEditEstimatedTime ? (
            <EstimatedTimeEditor
              taskId={task.id}
              currentMinutes={task.estimatedMinutes}
              onUpdate={onEstimatedMinutesUpdate}
            />
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {model.summary.metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
                <p className="text-[11px] text-[#A8A29E]">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        {rootGuidance}

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-2 dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="flex gap-1 overflow-x-auto">
            {model.anchors.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${anchor.active ? 'bg-[#C75B3A] font-semibold text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
              >
                {anchor.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计划 vs 实际</h3>
          <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.planActual.planContent}</p>
          <p className="mt-1 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.planActual.actualContent}</p>
          <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2 text-xs text-[#C75B3A] dark:bg-[#2A231B]">{model.planActual.diffReason}</p>
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">事件时间线</h3>
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
                  <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">AI 总结</h3>
          <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{model.aiSummary.summaryText}</p>
          <div className="mt-3 space-y-2 rounded-xl bg-[#F8F5F2] p-3 dark:bg-[#292524]">
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">关键产出：{model.aiSummary.keyOutput}</p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">阻塞点：{model.aiSummary.blocker}</p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">建议：{model.aiSummary.suggestion}</p>
          </div>
        </section>

        <DependencyCard
          dependencyView={dependencyView}
          taskDagView={taskDagView}
          selectedTaskId={dependencySelectedTaskId}
          selectedType={dependencySelectedType}
          errorMessage={dependencyError}
          isSaving={isDependencySaving}
          onSelectedTaskChange={onDependencySelectedTaskChange}
          onSelectedTypeChange={onDependencySelectedTypeChange}
          onAddDependency={onAddDependency}
          onChangeDependencyType={onChangeDependencyType}
          onRemoveDependency={onRemoveDependency}
          onToggleCollapseUpstream={onToggleCollapseUpstream}
        />

        <DetailActionsCard
          model={model}
          onRestart={onStartTimer}
          onCopySummary={onCopySummary}
        />

        <section
          data-testid="task-timer-card"
          className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计时控制</h3>
          {timerControls}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onStartTimer}
              disabled={hasOtherActiveBlock}
              className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
            >
              <Play size={14} />
              开始计时
            </button>
            <button
              type="button"
              data-testid="task-pause-button"
              onClick={onPauseAndGoEventlog}
              className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
            >
              <Pause size={14} />
              {hasActiveBlockOnTask ? '暂停并前往当下' : '前往当下'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function DesktopTimeblockDetail({
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
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  onStartTimer,
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
}: {
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
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  onStartTimer: () => void;
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
}) {
  return (
    <div className="min-h-full bg-[#FAF7F5] px-8 py-6 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <p className="select-none text-xs text-[#A8A29E]">
          <Link to="/tasks" className="hover:text-[#78716C] dark:hover:text-[#D6D3D1]">任务</Link>
          {backLink.sourceLabel !== '任务' && (
            <>
              <span> &gt; </span>
              <Link to={backLink.to} search={backLink.search} className="hover:text-[#78716C] dark:hover:text-[#D6D3D1]">{backLink.sourceLabel}</Link>
            </>
          )}
          <span> &gt; 任务详情</span>
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
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
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {model.summary.metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
                <p className="text-xs text-[#A8A29E]">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
              </div>
            ))}
          </div>
          {canEditEstimatedTime ? (
            <EstimatedTimeEditor
              taskId={task.id}
              currentMinutes={task.estimatedMinutes}
              onUpdate={onEstimatedMinutesUpdate}
            />
          ) : null}
        </section>

        <section
          data-testid="task-timer-card"
          className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计时控制</h3>
          {timerControls}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onStartTimer}
              disabled={hasOtherActiveBlock}
              className="inline-flex items-center gap-1 rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
            >
              <Play size={14} />
              开始计时
            </button>
            <button
              type="button"
              data-testid="task-pause-button"
              onClick={onPauseAndGoEventlog}
              className="inline-flex items-center gap-1 rounded-xl border border-[#E7E5E4] px-4 py-2 text-sm font-medium text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
            >
              <Pause size={14} />
              {hasActiveBlockOnTask ? '暂停并前往当下' : '前往当下'}
            </button>
          </div>
        </section>
      </div>

      <section className="mt-4 grid grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="space-y-3">
          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
            <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">事件时间线</h2>
            <div className="mt-4 space-y-3">
              {model.timeline.items.map((item) => (
                <article key={item.id} className="flex gap-3">
                  <span className={`mt-1 h-2 w-2 rounded-full ${toneDotClassName(item.tone)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                      <p className="text-xs text-[#A8A29E]">{item.timeLabel}</p>
                    </div>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-3">
          {rootGuidance}

          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">洞察</h3>
            <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{task.title}</p>
            {task.description ? (
              <p className="mt-2 whitespace-pre-wrap text-xs text-[#78716C] dark:text-[#A8A29E]">{task.description}</p>
            ) : null}
          </section>

          <DependencyCard
            dependencyView={dependencyView}
            taskDagView={taskDagView}
            selectedTaskId={dependencySelectedTaskId}
            selectedType={dependencySelectedType}
            errorMessage={dependencyError}
            isSaving={isDependencySaving}
            onSelectedTaskChange={onDependencySelectedTaskChange}
            onSelectedTypeChange={onDependencySelectedTypeChange}
            onAddDependency={onAddDependency}
            onChangeDependencyType={onChangeDependencyType}
            onRemoveDependency={onRemoveDependency}
            onToggleCollapseUpstream={onToggleCollapseUpstream}
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
            onRestart={onStartTimer}
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
  const isDesktop = useIsDesktop();
  const preferredBlockId = blockIdParam || resolvePreferredBlockId();
  const backLink = resolveTimeblockSourceBackLink();

  const [task, setTask] = useState<TaskNode | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [hasOtherActiveBlock, setHasOtherActiveBlock] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewMarkdown, setReviewMarkdown] = useState('');
  const [eventLogs, setEventLogs] = useState<TimeblockEventLog[]>([]);
  const [allTasks, setAllTasks] = useState<TaskNode[]>([]);
  const [dependencySelectedTaskId, setDependencySelectedTaskId] = useState('');
  const [dependencySelectedType, setDependencySelectedType] = useState<DependencyType>('soft');
  const [dagVisibilityState, setDagVisibilityState] = useState<TaskDagVisibilityState>({ collapsedUpstreamOf: [] });
  const [dependencyLoadError, setDependencyLoadError] = useState<string | null>(null);
  const [dependencyActionError, setDependencyActionError] = useState<string | null>(null);
  const [isDependencySaving, setIsDependencySaving] = useState(false);
  const [dependencyReloadKey, setDependencyReloadKey] = useState(0);
  const timerResetKey = taskId ?? preferredBlockId ?? task?.id;
  const timerInitialMinutes = taskId
    ? task?.id === taskId ? task.estimatedMinutes : undefined
    : task?.estimatedMinutes;
  const {
    timerMode,
    countdownMinutes,
    setTimerMode,
    setCountdownMinutes,
    customDurationDraft,
    setCustomDurationDraft,
    commitCustomDuration,
    timerConfig,
  } = useTimerConfig(timerInitialMinutes, timerResetKey);

  useLayoutEffect(() => {
    setIsLoading(true);
    setTask(null);
    setActiveBlock(null);
    setHasOtherActiveBlock(false);
    setEventLogs([]);
    setReviewMarkdown('');
  }, [dependencyReloadKey, preferredBlockId, taskId]);

  useEffect(() => {
    setDagVisibilityState({ collapsedUpstreamOf: [] });
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
      setActiveBlock(nextTask && currentBlock?.taskId === nextTask.id ? currentBlock : null);
      setHasOtherActiveBlock(Boolean(currentBlock && nextTask && currentBlock.taskId !== nextTask.id));

      if (nextTask) {
        const events = await getEventStorage().getEvents();
        const matchedBlockName = preferredBlockId
          ? blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId)?.name
          : undefined;
        if (!disposed) {
          setEventLogs(events.map((event) => ({
            id: event.id,
            createdAt: event.createdAt,
            content: event.content,
            type: event.type,
          })));
          setReviewMarkdown(selectReviewMarkdown(nextTask, matchedBlockName ?? nextTask.title, events));
        }
      } else {
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
    <TaskCurrentRootCard graph={taskGraph} taskById={taskById} currentTaskId={task?.id} />
  ), [task?.id, taskById, taskGraph]);
  const canEditEstimatedTime = useMemo(
    () => (task ? allTasks.some((candidate) => candidate.id === task.id) && !isTerminalTaskStatus(task.status) : false),
    [allTasks, task],
  );
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
      onSelectCountup={() => setTimerMode('countup')}
    />
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
      collapsedUpstreamOf: currentState.collapsedUpstreamOf.includes(targetTaskId)
        ? currentState.collapsedUpstreamOf.filter((taskId) => taskId !== targetTaskId)
        : [...currentState.collapsedUpstreamOf, targetTaskId],
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
    if (!taskId) return;
    void getTaskTimerService().startBlockForTask(taskId, timerConfig).then(() => {
      void navigate({ to: '/eventlog' });
    });
  };

  const handlePauseAndGoEventlog = () => {
    if (!activeBlock) {
      void navigate({ to: '/eventlog' });
      return;
    }
    void getTimeBlockService().pauseBlock().finally(() => {
      void navigate({ to: '/eventlog' });
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
  }, [task?.id]);

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
        <Link to={backLink.to} search={backLink.search} className="inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
          {backLink.label.replace('← ', '')}
        </Link>
        <p className="mt-3 text-sm text-[#A8A29E]">任务不存在</p>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <DesktopTimeblockDetail
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
        hasOtherActiveBlock={hasOtherActiveBlock}
        hasActiveBlockOnTask={Boolean(activeBlock)}
        onStartTimer={handleStartTimer}
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
      />
    );
  }

  return (
    <MobileTimeblockDetail
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
      hasOtherActiveBlock={hasOtherActiveBlock}
      hasActiveBlockOnTask={Boolean(activeBlock)}
      onStartTimer={handleStartTimer}
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
    />
  );
}
