import { Link } from '@tanstack/react-router';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<TaskNode['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};


export function TaskCurrentRootCard({
  graph,
  taskById,
  currentTaskId,
  className,
}: {
  graph: TaskGraph;
  taskById: Map<string, TaskNode>;
  currentTaskId?: string;
  className?: string;
}) {
  const unblockedTasks = graph.currentRootCandidateNodeIds
    .map((id) => taskById.get(id))
    .filter((t): t is TaskNode => t != null);

  return (
    <section
      data-testid="task-current-root-card"
      className={cn(
        'rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">
        未阻塞节点 · {unblockedTasks.length}
      </p>
      {unblockedTasks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {unblockedTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status] ?? 'bg-[#A8A29E]'}`} />
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
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
      ) : (
        <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          所有未终态节点都被依赖关系阻塞
        </p>
      )}
    </section>
  );
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-[#A8A29E]',
  in_progress: 'bg-[#C75B3A]',
  suspended: 'bg-[#D97706]',
  completed: 'bg-[#16A34A]',
  cancelled: 'bg-[#6B7280]',
};
