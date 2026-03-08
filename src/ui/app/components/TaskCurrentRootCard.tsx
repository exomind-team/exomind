import { Link } from '@tanstack/react-router';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<TaskNode['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

function resolveExecutionHint(status: TaskNode['status'], isExecutable: boolean, isBlocked: boolean): string {
  if (status === 'in_progress') return '进行中';
  if (status === 'suspended') return '已挂起';
  if (isExecutable && isBlocked) return '可执行（软阻塞提醒）';
  if (isExecutable) return '可直接开始';
  if (isBlocked) return '受阻';
  return '待处理';
}

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
  const currentRootTask = graph.currentRootNodeId ? taskById.get(graph.currentRootNodeId) ?? null : null;
  const currentRootNode = graph.currentRootNodeId
    ? graph.nodes.find((node) => node.id === graph.currentRootNodeId) ?? null
    : null;
  const isViewingCurrentRoot = Boolean(currentRootTask && currentTaskId === currentRootTask.id);
  const currentRootOrder = currentRootTask ? graph.currentRootCandidateNodeIds.indexOf(currentRootTask.id) + 1 : 0;

  return (
    <section
      data-testid="task-current-root-card"
      className={cn(
        'rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">当前根节点</p>
          {currentRootTask && currentRootNode ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isViewingCurrentRoot ? (
                  <span className="rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[10px] font-semibold text-[#B45309]">
                    当前查看中
                  </span>
                ) : null}
                <span className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-[10px] font-semibold text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                  {STATUS_LABEL[currentRootTask.status]}
                </span>
                <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[10px] font-semibold text-[#2563EB] dark:bg-[#1E293B] dark:text-[#93C5FD]">
                  {resolveExecutionHint(currentRootNode.status, currentRootNode.isExecutable, currentRootNode.isBlocked)}
                </span>
              </div>
              <p className="mt-3 truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{currentRootTask.title}</p>
              <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                {`共 ${graph.currentRootCandidateNodeIds.length} 个未阻塞节点 · 当前按稳定顺序排第 ${currentRootOrder} 个`}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">暂无未阻塞节点</p>
              <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                当前所有未终态节点都被依赖关系阻塞，可前往 DAG 视图检查阻塞来源。
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {currentRootTask ? (
            <Link
              data-testid="task-current-root-link"
              to="/tasks/$taskId"
              params={{ taskId: currentRootTask.id }}
              className="inline-flex items-center rounded-full bg-[#C75B3A] px-3 py-2 text-xs font-semibold text-white"
            >
              {isViewingCurrentRoot ? '查看当前根节点' : '跳到当前根节点'}
            </Link>
          ) : null}
          <Link
            data-testid="task-current-root-dag-link"
            to="/tasks/dag"
            className="inline-flex items-center rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
          >
            查看 DAG 视图
          </Link>
        </div>
      </div>
    </section>
  );
}
