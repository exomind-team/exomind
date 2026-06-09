import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { cn } from '@/lib/utils';
import { filterTasksByTitleFuzzySearch } from '@/ui/app/pages/task-title-fuzzy-search';

const STATUS_LABEL: Record<TaskNode['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-[#A8A29E]',
  in_progress: 'bg-[#22C55E]',
  suspended: 'bg-[#D97706]',
  completed: 'bg-[#16A34A]',
  cancelled: 'bg-[#6B7280]',
};

export function TaskCurrentRootCard({
  graph,
  taskById,
  currentTaskId,
  className,
  searchQuery,
  collapsible = false,
  collapsedVisibleCount = 3,
}: {
  graph: TaskGraph;
  taskById: Map<string, TaskNode>;
  currentTaskId?: string;
  className?: string;
  searchQuery?: string;
  collapsible?: boolean;
  collapsedVisibleCount?: number;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const executableTasks = useMemo(() => graph.currentRootCandidateNodeIds
    .map((id) => taskById.get(id))
    .filter((task): task is TaskNode => task != null), [graph.currentRootCandidateNodeIds, taskById]);
  const filteredTasks = useMemo(
    () => filterTasksByTitleFuzzySearch(executableTasks, searchQuery ?? ''),
    [executableTasks, searchQuery],
  );
  const shouldCollapse = collapsible && filteredTasks.length > collapsedVisibleCount;
  const visibleTasks = shouldCollapse && collapsed
    ? filteredTasks.slice(0, collapsedVisibleCount)
    : filteredTasks;

  useEffect(() => {
    setCollapsed(true);
  }, [collapsedVisibleCount, searchQuery]);

  return (
    <section
      data-testid="task-current-root-card"
      className={cn(
        'rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">
          可执行任务 · {filteredTasks.length}
        </p>
        {shouldCollapse ? (
          <button
            type="button"
            data-testid="task-current-root-card-collapse-toggle"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#E7E5E4] px-2 py-1 text-[11px] font-medium text-[#78716C] dark:border-[#292524] dark:text-[#A8A29E]"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            <span>{collapsed ? '展开' : '收起'}</span>
          </button>
        ) : null}
      </div>
      {filteredTasks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {visibleTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status] ?? 'bg-[#A8A29E]'}`} />
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                data-testid={`task-current-root-card-link-${task.id}`}
                className={cn(
                  'truncate text-sm hover:underline',
                  currentTaskId === task.id
                    ? 'font-semibold text-[#C75B3A]'
                    : 'text-[#1C1917] dark:text-[#FAFAF9]',
                )}
              >
                {task.title}
              </Link>
              <span className="shrink-0 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                {STATUS_LABEL[task.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : searchQuery ? (
        <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          没有匹配标题的可执行任务
        </p>
      ) : (
        <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          所有未终态任务都被依赖关系阻塞
        </p>
      )}
    </section>
  );
}
