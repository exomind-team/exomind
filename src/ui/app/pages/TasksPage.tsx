import { Clock, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { getTaskService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';
import { PageShell } from '@/ui/app/components/PageShell';
import { PageMoreMenu } from '@/ui/app/components/PageMoreMenu';
import { NowInputRow } from '@/ui/app/components/NowInputRow';
import type { VoiceMessageInputHandle } from '@/components/VoiceMessageInput';
import { filterNow } from './task-tab-filters';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';
import {
  getTaskPageFuzzySearchEnabled,
  subscribeTaskPageFuzzySearchChanges,
} from '@/config/task-page-fuzzy-search';
import {
  getTaskCreateSuccessAction,
  subscribeTaskCreateSuccessActionChanges,
} from '@/config/task-create-success-action';
import {
  extractTaskTitleSearchQuery,
  filterTasksByTitleFuzzySearch,
} from './task-title-fuzzy-search';
import {
  registerMainWindowFocusTarget,
} from '@/services/main-window-focus-targets';
import { MAIN_WINDOW_FOCUS_TARGET_TASKS_QUICK_ADD_INPUT } from '@/services/main-window-shortcut.service';

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

const EMPTY_TEXT = '当前没有进行中的任务，开始一个吧。';
const EMPTY_SEARCH_TEXT = '没有匹配标题的任务，可继续输入后直接创建。';
export const TASKS_QUICK_ADD_DRAFT_KEY = 'exomind:draft:task-quick-add';
const TASKS_QUICK_ADD_SEARCH_DEBOUNCE_MS = 180;

function formatTaskMeta(task: TaskNode): string {
  return task.estimatedMinutes ? `预计 ${task.estimatedMinutes}min` : '未估时';
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

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [quickAddValue, setQuickAddValue] = useState('');
  const [debouncedQuickAddValue, setDebouncedQuickAddValue] = useState('');
  const [taskPageFuzzySearchEnabled, setTaskPageFuzzySearchEnabled] = useState<boolean>(() => getTaskPageFuzzySearchEnabled());
  const [taskCreateSuccessAction, setTaskCreateSuccessAction] = useState(() => getTaskCreateSuccessAction());
  const inputRef = useRef<VoiceMessageInputHandle>(null);
  const navigate = useNavigate();

  // Auto-focus input on Enter key when nothing is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement === document.body) {
        e.preventDefault();
        inputRef.current?.focusText();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    let disposed = false;
    const svc = getTaskService();
    const load = async () => {
      const list = await svc.listTasks(true);
      if (!disposed) {
        setTasks(list);
      }
    };
    void load();

    const unsubscribe = svc.onTaskChange(() => {
      void load();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const taskGraph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const taskTitleSearchQuery = useMemo(() => extractTaskTitleSearchQuery(debouncedQuickAddValue), [debouncedQuickAddValue]);

  useEffect(() => subscribeTaskPageFuzzySearchChanges(setTaskPageFuzzySearchEnabled), []);
  useEffect(() => subscribeTaskCreateSuccessActionChanges(setTaskCreateSuccessAction), []);
  useEffect(() => registerMainWindowFocusTarget(
    MAIN_WINDOW_FOCUS_TARGET_TASKS_QUICK_ADD_INPUT,
    () => {
      inputRef.current?.focusText();
    },
  ), []);

  useEffect(() => {
    if (!taskPageFuzzySearchEnabled) {
      setDebouncedQuickAddValue('');
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuickAddValue(quickAddValue);
    }, TASKS_QUICK_ADD_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [quickAddValue, taskPageFuzzySearchEnabled]);

  const visibleTasks = useMemo(() => {
    const isSearching = taskPageFuzzySearchEnabled && Boolean(taskTitleSearchQuery);
    const baseTasks = isSearching ? tasks : filterNow(tasks, taskGraph);
    if (!taskPageFuzzySearchEnabled) {
      return baseTasks;
    }
    return filterTasksByTitleFuzzySearch(baseTasks, taskTitleSearchQuery);
  }, [taskPageFuzzySearchEnabled, taskGraph, taskTitleSearchQuery, tasks]);

  const handleQuickAdd = useCallback(async (content: string) => {
    const lines = content.trim().split('\n');
    const title = lines[0].trim();
    const description = lines.slice(1).join('\n').trim() || undefined;
    if (!title) return;
    const created = await getTaskService().createTask({
      title,
      description,
    });
    setTasks((prev) => [created, ...prev]);
    if (taskCreateSuccessAction === 'open-detail') {
      await navigate({
        to: '/tasks/$taskId',
        params: { taskId: created.id },
      });
    }
  }, [navigate, taskCreateSuccessAction]);

  const emptyText = taskPageFuzzySearchEnabled && taskTitleSearchQuery ? EMPTY_SEARCH_TEXT : EMPTY_TEXT;

  return (
    <PageShell
      title="任务"
      contentClassName="min-h-0 flex-1"
      headerAction={(
        <div className="flex items-center gap-2">
          <Link
            to="/tasks/timeline"
            className="inline-flex items-center gap-1 rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
          >
            <Clock size={16} />
            <span className="hidden md:inline">时间线</span>
          </Link>
          <Link
            to="/tasks/dag"
            className="inline-flex items-center gap-1 rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
          >
            <Waypoints size={16} />
            <span className="hidden md:inline">依赖图</span>
          </Link>
          <PageMoreMenu />
        </div>
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-page px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-3 dark:bg-page-dark md:px-8 md:pb-24 lg:px-10" data-testid="new-tasks-page">
        <TaskCurrentRootCard
          graph={taskGraph}
          taskById={taskById}
          className="mb-4"
          searchQuery={taskPageFuzzySearchEnabled ? taskTitleSearchQuery : ''}
          collapsible={true}
        />

        <div className="space-y-3">
          {visibleTasks.length > 0 ? (
            visibleTasks.map((task) => (
              <Link
                key={task.id}
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className="block"
                data-testid={`tasks-page-task-link-${task.id}`}
              >
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
                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-[#78716C] dark:text-[#A8A29E]">{task.description.slice(0, 100)}</p>
                    )}
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
              {emptyText}
            </p>
          )}
        </div>
      </div>

      <NowInputRow
        ref={inputRef}
        onSend={handleQuickAdd}
        onValueChange={setQuickAddValue}
        placeholder="添加任务与描述..."
        draftStorageKey={TASKS_QUICK_ADD_DRAFT_KEY}
      />
    </PageShell>
  );
}
