import { EllipsisVertical, Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getTaskService } from '@/lib/services';
import type { TaskItem } from '@/lib/types/task';

type TaskTab = 'now' | 'today' | 'week' | 'month' | 'goals';

const TAB_ITEMS: Array<{ id: TaskTab; label: string }> = [
  { id: 'now', label: '当下' },
  { id: 'today', label: '今日' },
  { id: 'week', label: '一周' },
  { id: 'month', label: '月' },
  { id: 'goals', label: '长期' },
];

function formatTaskMeta(task: TaskItem): string {
  const estimated = task.estimatedMinutes ? `预计 ${task.estimatedMinutes}min` : '未估时';
  const spent = task.spentMinutes ? `已用 ${task.spentMinutes}min` : '未计时';
  return `${estimated} · ${spent}`;
}

export function NewTasksPage() {
  const [activeTab, setActiveTab] = useState<TaskTab>('now');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [quickInput, setQuickInput] = useState('');

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const list = await getTaskService().listTasks();
      if (!disposed) setTasks(list);
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const visibleTasks = useMemo(() => {
    if (activeTab === 'now') {
      const active = tasks.filter((item) => item.status === 'in_progress');
      return active.length > 0 ? active : tasks.slice(0, 3);
    }
    if (activeTab === 'today') {
      return tasks.slice(0, 5);
    }
    return tasks;
  }, [activeTab, tasks]);

  const handleQuickAdd = async () => {
    const title = quickInput.trim();
    if (!title) return;
    const created = await getTaskService().createTask({
      title,
      mode: 'countdown',
      targetMinutes: 25,
    });
    setTasks((prev) => [created, ...prev]);
    setQuickInput('');
  };

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-tasks-page">
      <header className="flex items-center justify-between px-6 py-3">
        <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务</h1>
        <div className="flex items-center gap-2">
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
            <SlidersHorizontal size={18} />
          </button>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F0ED] text-[#1C1917] dark:bg-[#292524] dark:text-[#FAFAF9]">
            <EllipsisVertical size={18} />
          </button>
        </div>
      </header>

      <div className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)]">
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
          {visibleTasks.map((task) => (
            <article
              key={task.id}
              className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
            >
              <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
              <p className="mt-1 text-xs text-[#A8A29E]">{formatTaskMeta(task)}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+62px)] px-4 pb-2">
        <div className="flex items-center gap-2 rounded-[24px] border border-[#E7E5E4] bg-white px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
          <input
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

