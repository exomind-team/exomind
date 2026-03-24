import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { getTaskService, getTimeBlockService } from '@/lib/services';
import { resolveActiveBlockTaskIds, resolveTimeBlockRelatedTaskIds, type ActiveBlockData, type TimeBlock } from '@/lib/types/event';
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

function buildActiveBlockSignature(block: ActiveBlockData | null): string {
  if (!block) {
    return 'null';
  }

  return [
    block.startId,
    block.phase ?? '',
    block.version ?? '',
    block.lastTransitionAt ?? '',
    block.actorId ?? '',
    block.paused ? '1' : '0',
    block.feedbackSubmittedAt ?? '',
    block.taskIds.join(','),
    JSON.stringify(block.taskAssociationLog ?? []),
  ].join('|');
}

function buildTimeBlockSignature(block: TimeBlock): string {
  return [
    block.id,
    block.startId,
    block.endId,
    block.startTime,
    block.endTime,
    block.note ?? '',
    resolveTimeBlockRelatedTaskIds(block).join(','),
    JSON.stringify(block.taskStatusOutcomes ?? {}),
    JSON.stringify(block.taskAssociationLog ?? []),
  ].join('|');
}

function buildTimeBlocksSignature(blocks: TimeBlock[]): string {
  return blocks.map((block) => buildTimeBlockSignature(block)).join('||');
}

function collectRelevantTaskIds(blocks: TimeBlock[], activeBlock: ActiveBlockData | null): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    for (const taskId of resolveTimeBlockRelatedTaskIds(block)) {
      ids.add(taskId);
    }
  }
  if (activeBlock) {
    for (const taskId of resolveActiveTaskIds(activeBlock)) {
      ids.add(taskId);
    }
  }
  return Array.from(ids);
}

export function NowTodayTab() {
  const [completedBlocks, setCompletedBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const completedBlocksRef = useRef<TimeBlock[]>([]);
  const activeBlockRef = useRef<ActiveBlockData | null>(null);
  const completedBlocksSignatureRef = useRef('');
  const activeBlockSignatureRef = useRef('null');
  const taskIdsSignatureRef = useRef('');

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();

    const syncTasks = async (
      blocks: TimeBlock[],
      currentActiveBlock: ActiveBlockData | null,
      forceRefresh: boolean,
    ) => {
      const taskIds = collectRelevantTaskIds(blocks, currentActiveBlock);
      const signature = taskIds.join('|');
      if (!forceRefresh && signature === taskIdsSignatureRef.current) {
        return;
      }

      taskIdsSignatureRef.current = signature;
      const tasks = await Promise.all(taskIds.map((taskId) => taskService.getTask(taskId)));
      if (disposed) {
        return;
      }

      setTasksById(new Map(tasks.filter((task): task is TaskNode => Boolean(task)).map((task) => [task.id, task])));
    };

    const applyCompletedBlocks = (nextBlocks: TimeBlock[]): boolean => {
      const signature = buildTimeBlocksSignature(nextBlocks);
      if (signature === completedBlocksSignatureRef.current) {
        return false;
      }

      completedBlocksSignatureRef.current = signature;
      completedBlocksRef.current = nextBlocks;
      setCompletedBlocks(nextBlocks);
      return true;
    };

    const applyActiveBlock = (nextBlock: ActiveBlockData | null): boolean => {
      const signature = buildActiveBlockSignature(nextBlock);
      if (signature === activeBlockSignatureRef.current) {
        return false;
      }

      activeBlockSignatureRef.current = signature;
      activeBlockRef.current = nextBlock;
      setActiveBlock(nextBlock);
      return true;
    };

    const loadSnapshot = async (forceRefreshTasks = false) => {
      const [loadedBlocks, loadedActiveBlock] = await Promise.all([
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
      ]);
      if (disposed) return;

      const blocksChanged = applyCompletedBlocks(loadedBlocks);
      const activeChanged = applyActiveBlock(loadedActiveBlock);
      if (forceRefreshTasks || blocksChanged || activeChanged) {
        await syncTasks(loadedBlocks, loadedActiveBlock, forceRefreshTasks);
      }
      if (disposed) {
        return;
      }

      setNow(new Date());
      setLoading(false);
    };

    void loadSnapshot(true);
    const unsubscribeTasks = taskService.onTaskChange(() => {
      void syncTasks(completedBlocksRef.current, activeBlockRef.current, true);
    });
    const unsubscribeBlocks = timeBlockService.onBlockChange((block) => {
      if (block === null) {
        void loadSnapshot(false);
        return;
      }

      const activeChanged = applyActiveBlock(block);
      if (activeChanged) {
        setNow(new Date());
        void syncTasks(completedBlocksRef.current, block, false);
      }
    });

    return () => {
      disposed = true;
      unsubscribeTasks();
      unsubscribeBlocks();
    };
  }, []);

  useEffect(() => {
    setNow(new Date());

    if (!activeBlock || !isToday(activeBlock.startTime, new Date())) {
      return;
    }

    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [activeBlock]);

  const blocks = useMemo(() => {
    const nextBlocks = [...completedBlocks];
    if (activeBlock && isToday(activeBlock.startTime, now)) {
      nextBlocks.push(buildRunningTimeBlock(activeBlock, now.getTime()));
    }
    return nextBlocks;
  }, [activeBlock, completedBlocks, now]);

  const view = useMemo(() => buildNowTodayBlocksView({
    blocks,
    tasksById,
    now,
  }), [blocks, now, tasksById]);

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
