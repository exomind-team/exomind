import { Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { getTaskService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';
import { consumeTasksDefaultTab } from '@/config/tasks-default-tab';
import { PageMoreMenu } from '@/ui/app/components/PageMoreMenu';
import { filterMonth, filterNow, filterToday, filterWeek } from './task-tab-filters';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

type TaskTab = 'now' | 'today' | 'week' | 'month';

const TAB_ITEMS: Array<{ id: TaskTab; label: string }> = [
  { id: 'now', label: '当下' },
  { id: 'today', label: '今日' },
  { id: 'week', label: '一周' },
  { id: 'month', label: '月' },
];

const STATUS_DOT: Record<string, string> = {
  not_started: 'bg-[#A8A29E]',
  in_progress: 'bg-[#16A34A]',
  suspended: 'bg-[#EAB308]',
  completed: 'bg-[#3B82F6]',
  abandoned: 'bg-[#EF4444]',
};

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
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

function resolveInitialTaskTab(): TaskTab {
  const preferredTab = consumeTasksDefaultTab();
  if (preferredTab && TAB_ITEMS.some((tab) => tab.id === preferredTab)) {
    return preferredTab as TaskTab;
  }

  if (typeof window === 'undefined') {
    return 'now';
  }

  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (urlTab && TAB_ITEMS.some((tab) => tab.id === urlTab)) {
    return urlTab as TaskTab;
  }

  return 'now';
}

export function TasksPage() {
  const isDesktop = useIsDesktop();
  const [activeTab, setActiveTab] = useState<TaskTab>(() => resolveInitialTaskTab());
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [quickInput, setQuickInput] = useState('');
  const quickInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    const svc = getTaskService();
    const load = async () => {
      const list = await svc.listTasks();
      if (!disposed) {
        setTasks(list);
      }
    };
    void load();

    // Refresh list when remote sync delivers changes
    const unsubscribe = svc.onTaskChange(() => {
      void load();
    });

    return () => {
      disposed = true;
      unsubscribe();
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
  };

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-tasks-page">
      <header className="flex items-center justify-between border-b border-[#F0ECE8] px-6 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务</h1>
        <div className="flex items-center gap-2">
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

        <div className="space-y-3">
          {visibleTasks.length > 0 ? (
            visibleTasks.map((task) => (
              <Link key={task.id} to="/tasks/$taskId" params={{ taskId: task.id }} className="block">
                <article className="flex overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
                  <div className={`w-[3px] shrink-0 self-stretch ${STATUS_DOT[task.status] ?? 'bg-[#A8A29E]'}`} />
                  <div className="flex-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
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
      </div>

      <div className={`sticky px-4 pb-2 md:px-8 lg:px-10 ${isDesktop ? 'bottom-4' : 'bottom-[calc(env(safe-area-inset-bottom,0px)+62px)]'}`}>
        <div className="flex items-center gap-2 rounded-[24px] border border-[#E7E5E4] bg-white px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
          <input
            ref={quickInputRef}
            value={quickInput}
            onChange={(event) => setQuickInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleQuickAdd();
              }
            }}
            placeholder="快速添加任务..."
            className="flex-1 bg-transparent text-sm text-[#44403C] outline-none placeholder:text-[#A8A29E] dark:text-[#E7E5E4] dark:placeholder:text-[#78716C]"
          />
          <button
            type="button"
            onClick={() => {
              void handleQuickAdd();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C75B3A] text-white"
            aria-label="添加任务（Add Task）"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
