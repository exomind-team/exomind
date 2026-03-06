import { ArrowLeft, Ellipsis, Pause, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import { getEventStorage } from '@/lib/storage/event-storage';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { getUseMockDataEnabled } from '@/config/mock-data';
import {
  buildTaskTimeblockDetailViewModel,
  type TimeblockEventLog,
  type TaskTimeblockDetailViewModel,
  type TimeblockBadge,
} from './task-timeblock-detail-view';

type TimerMode = 'countup' | 'countdown';

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

function MobileTimeblockDetail({
  task,
  model,
  timerMode,
  setTimerMode,
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  onStartTimer,
  onPauseAndGoEventlog,
  onCopySummary,
}: {
  task: TaskNode;
  model: TaskTimeblockDetailViewModel;
  timerMode: TimerMode;
  setTimerMode: (mode: TimerMode) => void;
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  onStartTimer: () => void;
  onPauseAndGoEventlog: () => void;
  onCopySummary: () => void;
}) {
  return (
    <div className="min-h-full bg-[#FAF7F5] pb-10 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#F0ECE8] bg-[#FAF7F5]/95 px-4 py-3 backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/95">
        <Link
          to="/tasks"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label="返回任务列表（Back to tasks）"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">时间块详情</h1>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
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
          <div className="mt-3 grid grid-cols-2 gap-2">
            {model.summary.metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
                <p className="text-[11px] text-[#A8A29E]">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

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
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="task-mode-countdown"
              aria-pressed={timerMode === 'countdown'}
              onClick={() => setTimerMode('countdown')}
              className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countdown' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
            >
              倒计时
            </button>
            <button
              type="button"
              data-testid="task-mode-countup"
              aria-pressed={timerMode === 'countup'}
              onClick={() => setTimerMode('countup')}
              className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countup' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
            >
              正计时
            </button>
          </div>
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
  timerMode,
  setTimerMode,
  hasOtherActiveBlock,
  hasActiveBlockOnTask,
  onStartTimer,
  onPauseAndGoEventlog,
  onCopySummary,
}: {
  task: TaskNode;
  model: TaskTimeblockDetailViewModel;
  timerMode: TimerMode;
  setTimerMode: (mode: TimerMode) => void;
  hasOtherActiveBlock: boolean;
  hasActiveBlockOnTask: boolean;
  onStartTimer: () => void;
  onPauseAndGoEventlog: () => void;
  onCopySummary: () => void;
}) {
  return (
    <div className="min-h-full bg-[#FAF7F5] px-8 py-6 dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <p className="text-xs text-[#A8A29E]">任务 &gt; 今日 &gt; 时间块详情</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{model.summary.blockName}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {model.summary.badges.map((badge) => (
              <span key={badge.label} className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClassName(badge)}`}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <section className="mt-4 rounded-2xl border border-[#E7E5E4] bg-white px-6 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="grid grid-cols-5 gap-3">
          {model.summary.metrics.map((metric) => (
            <div key={metric.key} className="rounded-xl bg-[#F8F5F2] px-3 py-2 dark:bg-[#292524]">
              <p className="text-xs text-[#A8A29E]">{metric.label}</p>
              <p className="mt-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
            </div>
          ))}
        </div>
      </section>

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
          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">洞察</h3>
            <p className="mt-2 text-sm text-[#44403C] dark:text-[#E7E5E4]">{task.title}</p>
          </section>

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

          <section
            data-testid="task-timer-card"
            className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
          >
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">计时控制</h3>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="task-mode-countdown"
                aria-pressed={timerMode === 'countdown'}
                onClick={() => setTimerMode('countdown')}
                className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countdown' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
              >
                倒计时
              </button>
              <button
                type="button"
                data-testid="task-mode-countup"
                aria-pressed={timerMode === 'countup'}
                onClick={() => setTimerMode('countup')}
                className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countup' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
              >
                正计时
              </button>
            </div>
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

  const [task, setTask] = useState<TaskNode | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [hasOtherActiveBlock, setHasOtherActiveBlock] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewMarkdown, setReviewMarkdown] = useState('');
  const [eventLogs, setEventLogs] = useState<TimeblockEventLog[]>([]);
  const [timerMode, setTimerMode] = useState<TimerMode>('countdown');

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();
    const load = async () => {
      if (!taskId && !preferredBlockId) {
        setIsLoading(false);
        return;
      }

      const [loadedTask, blocks, currentBlock] = await Promise.all([
        taskId ? taskService.getTask(taskId) : Promise.resolve(null),
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
      ]);
      let nextTask = loadedTask;
      if (!nextTask && preferredBlockId) {
        const matchedBlock = blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId);
        if (matchedBlock) {
          const allTasks = await taskService.listTasks(true);
          const linked = allTasks.find((candidate) => (candidate.timeBlockIds ?? []).includes(matchedBlock.startId));
          nextTask = linked ?? buildVirtualTaskFromBlock(matchedBlock);
        }
      }
      if (!nextTask) {
        const fallbackTasks = await taskService.listTasks();
        nextTask = fallbackTasks[0] ?? null;
      }

      if (disposed) return;
      setTask(nextTask);
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
  }, [preferredBlockId, taskId]);

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

  const handleStartTimer = () => {
    if (!taskId) return;
    const config = timerMode === 'countdown'
      ? { mode: 'countdown' as const, minutes: 25 }
      : { mode: 'countup' as const };
    void getTaskTimerService().startBlockForTask(taskId, config).then(() => {
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

  if (isLoading) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <p className="text-sm text-[#A8A29E]">加载中...</p>
      </div>
    );
  }

  if (!task || !viewModel) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
          返回任务
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
        timerMode={timerMode}
        setTimerMode={setTimerMode}
        hasOtherActiveBlock={hasOtherActiveBlock}
        hasActiveBlockOnTask={Boolean(activeBlock)}
        onStartTimer={handleStartTimer}
        onPauseAndGoEventlog={handlePauseAndGoEventlog}
        onCopySummary={handleCopySummary}
      />
    );
  }

  return (
    <MobileTimeblockDetail
      task={task}
      model={viewModel}
      timerMode={timerMode}
      setTimerMode={setTimerMode}
      hasOtherActiveBlock={hasOtherActiveBlock}
      hasActiveBlockOnTask={Boolean(activeBlock)}
      onStartTimer={handleStartTimer}
      onPauseAndGoEventlog={handlePauseAndGoEventlog}
      onCopySummary={handleCopySummary}
    />
  );
}
