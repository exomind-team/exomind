import { ArrowRight, Play, X } from 'lucide-react';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

type DependencyType = 'hard' | 'soft';

export interface TaskDagDependencyItem {
  taskId: string;
  title: string;
  type: DependencyType;
}

interface TaskDagDetailPanelProps {
  task: TaskNode | null;
  executionHint: string;
  upstreamDependencies: TaskDagDependencyItem[];
  downstreamDependencies: TaskDagDependencyItem[];
  onClose: () => void;
  onOpenDetail: () => void;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

const TYPE_LABELS: Record<DependencyType, string> = {
  hard: '硬依赖',
  soft: '软依赖',
};

function renderDependencyList(
  items: TaskDagDependencyItem[],
  emptyText: string,
  testId: string,
) {
  if (items.length === 0) {
    return <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">{emptyText}</p>;
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      {items.map((item) => (
        <div
          key={`${item.taskId}-${item.type}`}
          className="rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#3F3F46]"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
            <span className="shrink-0 rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {TYPE_LABELS[item.type]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TaskDagDetailPanel({
  task,
  executionHint,
  upstreamDependencies,
  downstreamDependencies,
  onClose,
  onOpenDetail,
}: TaskDagDetailPanelProps) {
  const isDesktop = useIsDesktop();

  if (!task) {
    return null;
  }

  return (
    <aside
      data-testid={isDesktop ? 'task-dag-detail-panel-desktop' : 'task-dag-detail-panel-mobile'}
      className={
        isDesktop
          ? 'pointer-events-auto absolute inset-y-4 right-4 z-20 w-[340px] overflow-hidden rounded-[28px] border border-[#E7E5E4] bg-white/95 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.2)] backdrop-blur dark:border-[#292524] dark:bg-[#1C1917]/95'
          : 'pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[72vh] overflow-hidden rounded-t-[28px] border border-b-0 border-[#E7E5E4] bg-white/95 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.25)] backdrop-blur dark:border-[#292524] dark:bg-[#1C1917]/95'
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[#F0ECE8] px-5 py-4 dark:border-[#292524]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">节点详情</p>
            <h2 className="mt-2 text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                {STATUS_LABELS[task.status]}
              </span>
              {task.estimatedMinutes ? (
                <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]">
                  {`预计 ${task.estimatedMinutes} 分钟`}
                </span>
              ) : (
                <span className="rounded-full bg-[#FAF7F5] px-2 py-0.5 text-[10px] font-medium text-[#A8A29E] dark:bg-[#120F0D] dark:text-[#78716C]">
                  未估时
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            data-testid="task-dag-detail-close"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E7E5E4] text-[#78716C] transition-colors hover:bg-[#F5F0ED] dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">执行提示</h3>
            <p className="mt-2 rounded-2xl bg-[#FAF7F5] px-4 py-3 text-sm text-[#57534E] dark:bg-[#120F0D] dark:text-[#D6D3D1]">
              {executionHint}
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">前置依赖</h3>
              <span className="text-[11px] text-[#A8A29E]">{upstreamDependencies.length}</span>
            </div>
            <div className="mt-2">
              {renderDependencyList(upstreamDependencies, '当前节点没有前置依赖。', 'task-dag-detail-upstream-list')}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">后继节点</h3>
              <span className="text-[11px] text-[#A8A29E]">{downstreamDependencies.length}</span>
            </div>
            <div className="mt-2">
              {renderDependencyList(downstreamDependencies, '当前节点没有后继依赖。', 'task-dag-detail-downstream-list')}
            </div>
          </section>
        </div>

        <div className="border-t border-[#F0ECE8] px-5 py-4 dark:border-[#292524]">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="task-dag-detail-open-task"
              onClick={onOpenDetail}
              className="inline-flex items-center gap-2 rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white"
            >
              <ArrowRight size={14} />
              查看详情
            </button>
            <button
              type="button"
              data-testid="task-dag-detail-start-timer"
              disabled
              title="执行模式将在 Wave 3 激活"
              className="inline-flex items-center gap-2 rounded-full border border-[#E7E5E4] px-4 py-2 text-sm font-semibold text-[#78716C] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3F3F46] dark:text-[#A8A29E]"
            >
              <Play size={14} />
              开始计时
            </button>
          </div>
          <p className="mt-3 text-xs text-[#A8A29E]">
            点击画布空白处或关闭按钮可收起面板。
          </p>
        </div>
      </div>
    </aside>
  );
}
