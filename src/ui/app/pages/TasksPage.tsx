import { CornerDownLeft, Plus, SlidersHorizontal, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { getTaskService, getTimeBlockService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import { getTasksDefaultTab } from '@/config/tasks-default-tab';
import { PageMoreMenu } from '@/ui/app/components/PageMoreMenu';
import { filterMonth, filterNow, filterToday, filterWeek } from './task-tab-filters';
import { buildTasksTodayViewModel } from './tasks-today-view';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';

type TaskTab = 'now' | 'today' | 'week' | 'month';

const TAB_ITEMS: Array<{ id: TaskTab; label: string }> = [
  { id: 'now', label: '当下' },
  { id: 'today', label: '今日' },
  { id: 'week', label: '一周' },
  { id: 'month', label: '月' },
];

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-[#A8A29E]',
  in_progress: 'bg-[#16A34A]',
  suspended: 'bg-[#EAB308]',
  completed: 'bg-[#3B82F6]',
  cancelled: 'bg-[#EF4444]',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

const TAB_EMPTY_TEXT: Record<TaskTab, string> = {
  now: '当前没有进行中的任务，开始一个吧。',
  today: '今天没有待处理的任务。',
  week: '本周没有截止的任务。',
  month: '本月没有截止的任务。',
};

function formatTaskMeta(task: TaskNode): string {
  return task.estimatedMinutes ? `预计 ${task.estimatedMinutes}min` : '未估时';
}

function formatTaskMetaCompact(task: TaskNode): string {
  if (!task.estimatedMinutes) {
    return '未估时';
  }
  if (task.estimatedMinutes % 60 === 0) {
    return `预计 ${task.estimatedMinutes / 60}h`;
  }
  return `预计 ${task.estimatedMinutes}min`;
}

function formatSpentMeta(task: TaskNode): string {
  return `${formatTaskMetaCompact(task)} · ${task.status === 'in_progress' ? '进行中' : '待开始'}`;
}

function CurrentRootBadge({
  taskId,
  currentRootNodeId,
}: {
  taskId: string;
  currentRootNodeId: string | null;
}) {
  if (taskId !== currentRootNodeId) {
    return null;
  }

  return (
    <span
      data-testid={`task-current-root-badge-${taskId}`}
      className="inline-flex items-center rounded-full bg-[#FDE7DC] px-2 py-0.5 text-[10px] font-semibold text-[#C75B3A]"
    >
      当前根节点
    </span>
  );
}

function resolveToneClasses(tone: 'green' | 'orange' | 'blue' | 'red' | 'stone'): {
  rail: string;
  tag: string;
  dot: string;
  actual: string;
} {
  if (tone === 'green') {
    return {
      rail: 'bg-[#16A34A]',
      tag: 'bg-[#DCFCE7] text-[#15803D]',
      dot: 'bg-[#16A34A]',
      actual: 'text-[#15803D]',
    };
  }
  if (tone === 'blue') {
    return {
      rail: 'bg-[#3B82F6]',
      tag: 'bg-[#EFF6FF] text-[#2563EB]',
      dot: 'bg-[#3B82F6]',
      actual: 'text-[#2563EB]',
    };
  }
  if (tone === 'red') {
    return {
      rail: 'bg-[#E7000B]',
      tag: 'bg-[#FEE2E2] text-[#DC2626]',
      dot: 'bg-[#E7000B]',
      actual: 'text-[#DC2626]',
    };
  }
  if (tone === 'orange') {
    return {
      rail: 'bg-[#C75B3A]',
      tag: 'bg-[#FFF7ED] text-[#C75B3A]',
      dot: 'bg-[#C75B3A]',
      actual: 'text-[#C75B3A]',
    };
  }
  return {
    rail: 'bg-[#78716C]',
    tag: 'bg-[#F5F0ED] text-[#78716C]',
    dot: 'bg-[#78716C]',
    actual: 'text-[#57534E]',
  };
}

function resolveInitialTaskTab(): { tab: TaskTab; redirectDag: boolean } {
  const preferredTab = getTasksDefaultTab();

  if (preferredTab === 'dag') {
    return { tab: 'now', redirectDag: true };
  }

  if (preferredTab && TAB_ITEMS.some((t) => t.id === preferredTab)) {
    return { tab: preferredTab as TaskTab, redirectDag: false };
  }

  if (typeof window === 'undefined') {
    return { tab: 'now', redirectDag: false };
  }

  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (urlTab && TAB_ITEMS.some((t) => t.id === urlTab)) {
    return { tab: urlTab as TaskTab, redirectDag: false };
  }

  return { tab: 'now', redirectDag: false };
}

export function TasksPage() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [initialResolution] = useState(() => resolveInitialTaskTab());
  const [activeTab, setActiveTab] = useState<TaskTab>(initialResolution.tab);
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const DRAFT_KEY = 'exomind:task-quick-add-draft';
  const [quickInput, setQuickInput] = useState(() => {
    try { return localStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
  });
  const quickInputRef = useRef<HTMLTextAreaElement>(null);

  const SEND_MODE_KEY = 'exomind:task-input-send-mode';
  type SendMode = 'enter' | 'ctrl-enter';
  const [sendMode, setSendMode] = useState<SendMode>(() => {
    try {
      const stored = localStorage.getItem(SEND_MODE_KEY);
      return stored === 'ctrl-enter' ? 'ctrl-enter' : 'enter';
    } catch { return 'enter'; }
  });
  const toggleSendMode = () => {
    const next: SendMode = sendMode === 'enter' ? 'ctrl-enter' : 'enter';
    setSendMode(next);
    try { localStorage.setItem(SEND_MODE_KEY, next); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (initialResolution.redirectDag) {
      void navigate({ to: '/tasks/dag' });
    }
  }, [initialResolution.redirectDag, navigate]);

  useEffect(() => {
    let disposed = false;
    const svc = getTaskService();
    const timeBlockService = getTimeBlockService();
    const load = async () => {
      const [list, blocks, nextActiveBlock] = await Promise.all([
        svc.listTasks(true),
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
      ]);
      if (!disposed) {
        setTasks(list);
        setTimeBlocks(blocks);
        setActiveBlock(nextActiveBlock);
      }
    };
    void load();

    // Refresh list when remote sync delivers changes
    const unsubscribe = svc.onTaskChange(() => {
      void load();
    });
    const unsubscribeBlocks = timeBlockService.onBlockChange(() => {
      void load();
    });

    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeBlocks();
    };
  }, []);

  const visibleTasks = useMemo(() => {
    const now = new Date();
    if (activeTab === 'now') return filterNow(tasks);
    if (activeTab === 'today') return filterToday(tasks, now);
    if (activeTab === 'week') return filterWeek(tasks, now);
    if (activeTab === 'month') return filterMonth(tasks, now);
    return tasks;
  }, [activeTab, tasks]);

  const todayViewModel = useMemo(() => buildTasksTodayViewModel({
    tasks: visibleTasks,
    blocks: timeBlocks,
    now: new Date(),
    activeBlock,
  }), [activeBlock, timeBlocks, visibleTasks]);

  const taskGraph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const duplicateCandidates = useMemo(() => {
    const q = quickInput.toLowerCase().trim();
    if (q.length < 2) return [];
    return tasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [quickInput, tasks]);

  const handleQuickInputChange = (value: string) => {
    setQuickInput(value);
    try { localStorage.setItem(DRAFT_KEY, value); } catch { /* ignore */ }
  };

  const handleQuickAdd = async () => {
    const title = quickInput.trim();
    if (!title) {
      quickInputRef.current?.focus();
      return;
    }
    const created = await getTaskService().createTask({
      title,
      estimatedMinutes: 25,
    });
    setTasks((prev) => [created, ...prev]);
    setQuickInput('');
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    quickInputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-tasks-page">
      <header className="flex items-center justify-between border-b border-[#F0ECE8] px-6 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/tasks/dag"
            className="inline-flex items-center gap-1 rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
          >
            <Waypoints size={16} />
            <span className="hidden md:inline">DAG</span>
          </Link>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
            <SlidersHorizontal size={18} />
          </button>
          <PageMoreMenu />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-3 md:px-8 md:pb-24 lg:px-10">
        <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
          {TAB_ITEMS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-2xl px-4 py-1.5 text-[13px] ${
                  active ? 'bg-[#C75B3A] font-semibold text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <TaskCurrentRootCard graph={taskGraph} taskById={taskById} className="mb-4" />

        {activeTab === 'today' ? (
          <div className="space-y-4">
            {todayViewModel.inProgressCount > 0 ? (
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#C75B3A]" />
                  <p className="text-[13px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">进行中</p>
                  <span className="text-[13px] text-[#A8A29E]">{todayViewModel.inProgressCount}</span>
                </div>
                <div className="space-y-2">
                  {todayViewModel.inProgressTasks.map((task) => (
                    <Link key={task.id} to="/tasks/$taskId" params={{ taskId: task.id }} className="block">
                      <article className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
                        <div className="flex items-start gap-3">
                          <div className="mt-1 h-5 w-5 rounded-full border-2 border-[#C75B3A]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
                              <CurrentRootBadge taskId={task.id} currentRootNodeId={taskGraph.currentRootNodeId} />
                            </div>
                            <p className="mt-1 text-xs text-[#A8A29E]">{formatSpentMeta(task)}</p>
                          </div>
                        </div>
                      </article>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {todayViewModel.timelineSections.length > 0 ? (
              <>
                <div className="h-px w-full bg-[#E7E5E4] dark:bg-[#292524]" />
                <section className="space-y-5">
                  {todayViewModel.timelineSections.map((section) => (
                    <div key={section.id} className="space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{section.label}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-[#A8A29E]">{section.rangeLabel}</p>
                          <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[11px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                            {section.durationLabel}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {section.items.map((item) => {
                          const tone = resolveToneClasses(item.tone);
                          return (
                            <Link
                              key={item.id}
                              to="/tasks/block/$blockId"
                              params={{ blockId: item.blockId }}
                              search={{ from: activeTab }}
                              data-testid={`tasks-today-block-link-${item.blockId}`}
                              className="block"
                            >
                              <article className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917] dark:hover:bg-[#292524]">
                                <div className="flex">
                                  <div className={`w-1 shrink-0 self-stretch ${tone.rail}`} />
                                  <div className="min-w-0 flex-1 px-4 py-3">
                                    <p className="text-[11px] font-medium text-[#A8A29E]">{item.timeLabel}</p>
                                    <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.tag}`}>
                                      {item.tagLabel}
                                    </div>
                                    {item.planText ? (
                                      <div className="mt-2 flex items-center gap-2 text-xs text-[#A8A29E]">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#D6D3D1]" />
                                        <span>计划: {item.planText}</span>
                                      </div>
                                    ) : null}
                                    <div className={`mt-2 flex items-center gap-2 text-xs font-medium ${tone.actual}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                                      <span>实际: {item.actualText}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                                    <p className="mt-1 text-[11px] text-[#78716C] dark:text-[#A8A29E]">{item.meta}</p>
                                    {item.note ? (
                                      <p className="mt-1 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        {`💬 "${item.note}"`}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </article>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              </>
            ) : todayViewModel.inProgressCount === 0 ? (
              <p
                data-testid="tasks-tab-empty"
                className="rounded-2xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-4 py-5 text-center text-sm text-[#A8A29E] dark:border-[#3A3432] dark:bg-[#1C1917] dark:text-[#B8B1AC]"
              >
                {TAB_EMPTY_TEXT.today}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleTasks.length > 0 ? (
            visibleTasks.map((task) => (
              <Link key={task.id} to="/tasks/$taskId" params={{ taskId: task.id }} className="block">
                <article className="flex overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
                  <div className={`w-[3px] shrink-0 self-stretch ${STATUS_DOT[task.status] ?? 'bg-[#A8A29E]'}`} />
                  <div className="flex-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
                        <CurrentRootBadge taskId={task.id} currentRootNodeId={taskGraph.currentRootNodeId} />
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F5F0ED] px-2 py-0.5 dark:bg-[#292524]">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] ?? 'bg-[#A8A29E]'}`} />
                        <span className="text-[10px] font-medium text-[#78716C] dark:text-[#A8A29E]">
                          {STATUS_LABEL[task.status] ?? task.status}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#A8A29E]">{formatTaskMeta(task)}</p>
                  </div>
                </article>
              </Link>
            ))
          ) : (
            <p
              data-testid="tasks-tab-empty"
              className="rounded-2xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-4 py-5 text-center text-sm text-[#A8A29E] dark:border-[#3A3432] dark:bg-[#1C1917] dark:text-[#B8B1AC]"
            >
              {TAB_EMPTY_TEXT[activeTab]}
            </p>
          )}
          </div>
        )}
      </div>

      <div className={`sticky px-4 pb-2 md:px-8 lg:px-10 ${isDesktop ? 'bottom-4' : 'bottom-[calc(env(safe-area-inset-bottom,0px)+62px)]'}`}>
        {duplicateCandidates.length > 0 && (
          <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <span className="font-medium">可能重复：</span>
            {duplicateCandidates.slice(0, 3).map(t => (
              <span key={t.id} className="ml-1">「{t.title}」</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-[24px] border border-[#E7E5E4] bg-white px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
          <textarea
            ref={quickInputRef}
            value={quickInput}
            rows={1}
            onChange={(event) => handleQuickInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (sendMode === 'enter' && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleQuickAdd();
              } else if (sendMode === 'ctrl-enter' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleQuickAdd();
              }
            }}
            placeholder="快速添加任务..."
            className="max-h-20 flex-1 resize-none bg-transparent text-sm text-[#44403C] outline-none placeholder:text-[#A8A29E] dark:text-[#E7E5E4] dark:placeholder:text-[#78716C]"
          />
          <button
            type="button"
            onClick={toggleSendMode}
            title={sendMode === 'enter' ? '当前：Enter 发送（点击切换为 Ctrl+Enter）' : '当前：Ctrl+Enter 发送（点击切换为 Enter）'}
            className="flex h-7 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-medium text-[#A8A29E] transition-colors hover:bg-[#F5F0ED] hover:text-[#78716C] dark:hover:bg-[#292524] dark:hover:text-[#D6D3D1]"
          >
            <CornerDownLeft size={12} />
            <span>{sendMode === 'enter' ? '↵' : '⌃↵'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void handleQuickAdd();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C75B3A] text-white"
            aria-label="添加任务（Add Task）"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
