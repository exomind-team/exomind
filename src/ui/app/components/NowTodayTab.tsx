import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { getTaskService, getTimeBlockService } from '@/lib/services';
import { resolveActiveBlockTaskIds, type ActiveBlockData, type TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { buildNowTodayBlocksView } from '@/ui/app/pages/now-today-blocks-view';

function isToday(timestamp: number, now: Date): boolean {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return timestamp >= start && timestamp < start + 86_400_000;
}

function resolveActiveTaskIds(block: ActiveBlockData): string[] {
  return resolveActiveBlockTaskIds(block);
}

function buildRunningTimeBlock(block: ActiveBlockData, now: number): TimeBlock {
  return {
    id: block.startId,
    startId: block.startId,
    endId: `${block.startId}-active`,
    name: block.name,
    note: '进行中',
    tags: new Set(['block_feedback']),
    startTime: block.startTime,
    endTime: now,
    taskIds: resolveActiveTaskIds(block),
    taskAssociationLog: block.taskAssociationLog ?? [],
  };
}

export function NowTodayTab() {
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();

    const load = async () => {
      setLoading(true);
      const now = new Date();
      const [completedBlocks, activeBlock] = await Promise.all([
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
      ]);

      const nextBlocks = [...completedBlocks];
      if (activeBlock && isToday(activeBlock.startTime, now)) {
        nextBlocks.push(buildRunningTimeBlock(activeBlock, now.getTime()));
      }

      const taskIds = Array.from(new Set(
        nextBlocks.flatMap((block) => resolveActiveBlockTaskIds(block)).filter(Boolean),
      ));
      const tasks = await Promise.all(taskIds.map((taskId) => taskService.getTask(taskId)));

      if (disposed) return;
      setBlocks(nextBlocks);
      setTasksById(new Map(tasks.filter((task): task is TaskNode => Boolean(task)).map((task) => [task.id, task])));
      setLoading(false);
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
  }, []);

  const view = useMemo(() => buildNowTodayBlocksView({
    blocks,
    tasksById,
    now: new Date(),
  }), [blocks, tasksById]);

  if (loading) {
    return <p className="px-1 py-4 text-sm text-[#78716C] dark:text-[#A8A29E]">加载今日时间块...</p>;
  }

  if (view.items.length === 0) {
    return <p className="px-1 py-4 text-sm text-[#78716C] dark:text-[#A8A29E]">今天还没有时间块记录。</p>;
  }

  return (
    <div className="space-y-3">
      {view.items.map((item) => (
        <Link
          key={item.blockId}
          to="/eventlog/timeblocks/$blockId"
          params={{ blockId: item.blockId }}
          className="block rounded-2xl border border-[#E7E5E4] bg-white p-4 transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917] dark:hover:bg-[#292524]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
              <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.timeLabel}</p>
            </div>
            <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {item.linkedTasks.length} 个任务
            </span>
          </div>

          {item.linkedTasks.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.linkedTasks.map((task) => (
                <span
                  key={`${item.blockId}-${task.taskId}`}
                  className="rounded-full bg-[#FFF7ED] px-2 py-1 text-[11px] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]"
                >
                  {task.title}{task.outcome ? ` · ${task.outcome}` : ''}
                </span>
              ))}
            </div>
          ) : null}

          {item.note ? (
            <p className="mt-3 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.note}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
