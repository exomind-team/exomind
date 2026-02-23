import { EllipsisVertical, Github, Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getTaskService } from '@/lib/services';
import type { TaskGoalCard, TaskGoalGroup, TaskGoalStatusTone, TaskItem } from '@/lib/types/task';

type TaskTab = 'now' | 'today' | 'week' | 'month' | 'goals';

const TAB_ITEMS: Array<{ id: TaskTab; label: string }> = [
  { id: 'now', label: '当下' },
  { id: 'today', label: '今日' },
  { id: 'week', label: '一周' },
  { id: 'month', label: '月' },
  { id: 'goals', label: '长期' },
];

const TONE_TEXT_CLASS: Record<TaskGoalStatusTone, string> = {
  success: 'text-[#16A34A]',
  warning: 'text-[#C75B3A]',
  danger: 'text-[#DC2626]',
  brand: 'text-[#C75B3A]',
  info: 'text-[#3B82F6]',
  indigo: 'text-[#6366F1]',
  lime: 'text-[#84CC16]',
  pink: 'text-[#EC4899]',
  neutral: 'text-[#A8A29E]',
};

const TONE_BG_CLASS: Record<TaskGoalStatusTone, string> = {
  success: 'bg-[#F0FDF4]',
  warning: 'bg-[#FFF7ED]',
  danger: 'bg-[#FEF2F2]',
  brand: 'bg-[#FFF7ED]',
  info: 'bg-[#EFF6FF]',
  indigo: 'bg-[#EEF2FF]',
  lime: 'bg-[#F7FEE7]',
  pink: 'bg-[#FDF2F8]',
  neutral: 'bg-[#F5F0ED]',
};

const TONE_FILL_CLASS: Record<TaskGoalStatusTone, string> = {
  success: 'bg-[#16A34A]',
  warning: 'bg-[#C75B3A]',
  danger: 'bg-[#DC2626]',
  brand: 'bg-[#C75B3A]',
  info: 'bg-[#3B82F6]',
  indigo: 'bg-[#6366F1]',
  lime: 'bg-[#84CC16]',
  pink: 'bg-[#EC4899]',
  neutral: 'bg-[#A8A29E]',
};

function formatTaskMeta(task: TaskItem): string {
  const estimated = task.estimatedMinutes ? `预计 ${task.estimatedMinutes}min` : '未估时';
  const spent = task.spentMinutes ? `已用 ${task.spentMinutes}min` : '未计时';
  return `${estimated} · ${spent}`;
}

function GoalCard({ goal }: { goal: TaskGoalCard }) {
  return (
    <article
      data-testid={`tasks-goal-card-${goal.id}`}
      className="overflow-hidden rounded-xl border border-[#E7E5E4] bg-white"
    >
      <div className="flex">
        <div className={`w-1 shrink-0 self-stretch ${TONE_FILL_CLASS[goal.accentTone]}`} />
        <div className="w-full space-y-1 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-[#1C1917]">{goal.title}</p>
              {goal.showGithubIcon ? <Github size={14} className="text-[#78716C]" /> : null}
            </div>
            <div className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${TONE_BG_CLASS[goal.status.tone]}`}>
              <span className="text-[9px] leading-none">{goal.status.icon}</span>
              <span className={`text-[10px] font-semibold leading-none ${TONE_TEXT_CLASS[goal.status.tone]}`}>{goal.status.text}</span>
            </div>
          </div>

          <p className="text-[11px] text-[#78716C]">{goal.focus}</p>
          <p className="text-[10px] text-[#A8A29E]">{goal.acceptance}</p>

          <div className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${TONE_FILL_CLASS[goal.stageTone]}`} />
            <span className={`text-[10px] font-semibold ${TONE_TEXT_CLASS[goal.stageTone]}`}>{goal.stage}</span>
          </div>

          {goal.progress ? (
            <div className="flex items-center gap-2">
              <div className="h-1 w-full rounded bg-[#F5F0ED]">
                <div
                  className={`h-full rounded ${TONE_FILL_CLASS[goal.progress.tone]}`}
                  style={{
                    width: `${Math.max(0, Math.min(100, goal.progress.value))}%`,
                  }}
                />
              </div>
              <span className={`shrink-0 text-[11px] font-semibold ${TONE_TEXT_CLASS[goal.progress.tone]}`}>
                {goal.progress.label ?? `${goal.progress.value}%`}
              </span>
            </div>
          ) : null}

          {goal.timeline ? <p className="text-[11px] text-[#A8A29E]">{goal.timeline}</p> : null}
        </div>
      </div>
    </article>
  );
}

function GoalGroupSection({ group }: { group: TaskGoalGroup }) {
  return (
    <section data-testid={`tasks-goals-group-${group.id}`} className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#78716C]">▼</span>
        <span className="text-sm">{group.icon}</span>
        <p className="text-sm font-semibold text-[#1C1917]">{group.title}</p>
        <div className="h-px flex-1" />
        <span className={`inline-flex items-center justify-center rounded-[10px] px-2 py-0.5 text-[11px] font-semibold ${TONE_BG_CLASS[group.badgeTone]} ${TONE_TEXT_CLASS[group.badgeTone]}`}>
          {group.badgeText}
        </span>
      </div>

      <div className="space-y-2">
        {group.goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} />
        ))}
      </div>
    </section>
  );
}

export function NewTasksPage() {
  const [activeTab, setActiveTab] = useState<TaskTab>('now');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [goalGroups, setGoalGroups] = useState<TaskGoalGroup[]>([]);
  const [quickInput, setQuickInput] = useState('');

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const [list, goals] = await Promise.all([
        getTaskService().listTasks(),
        getTaskService().getLongTermGoals(),
      ]);
      if (!disposed) {
        setTasks(list);
        setGoalGroups(goals);
      }
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

        {activeTab === 'goals' ? (
          <div className="space-y-3" data-testid="tasks-goals-content">
            {goalGroups.length > 0 ? (
              goalGroups.map((group) => <GoalGroupSection key={group.id} group={group} />)
            ) : (
              <p data-testid="tasks-goals-empty" className="rounded-2xl border border-dashed border-[#D6D3D1] px-4 py-5 text-sm text-[#A8A29E]">
                暂无长期目标数据，请在开发者设置中开启测试数据（Mock Data）。
              </p>
            )}
          </div>
        ) : (
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
        )}
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

