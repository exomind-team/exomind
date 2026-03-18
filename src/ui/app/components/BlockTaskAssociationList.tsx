import { useEffect, useMemo, useRef, useState } from 'react';
import { getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import type { ActiveBlockData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

function resolveActiveTaskIds(block: ActiveBlockData | null): string[] {
  if (!block) return [];
  if (block.taskIds?.length) return block.taskIds;
  return block.taskId ? [block.taskId] : [];
}

export function BlockTaskAssociationList() {
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();

    const loadSnapshot = async () => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const [nextBlock, tasks] = await Promise.all([
        timeBlockService.loadActiveBlock(),
        taskService.listTasks(true),
      ]);
      if (disposed || requestId !== loadRequestIdRef.current) return;
      setActiveBlock(nextBlock);
      setTasksById(new Map(tasks.map((task) => [task.id, task])));
    };

    const loadTasksOnly = async (nextBlock: ActiveBlockData | null) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const tasks = await taskService.listTasks(true);
      if (disposed || requestId !== loadRequestIdRef.current) return;
      setActiveBlock(nextBlock);
      setTasksById(new Map(tasks.map((task) => [task.id, task])));
    };

    void loadSnapshot();
    const unsubscribeTasks = taskService.onTaskChange(() => {
      void loadSnapshot();
    });
    const unsubscribeBlocks = timeBlockService.onBlockChange((block) => {
      void loadTasksOnly(block);
    });

    return () => {
      disposed = true;
      unsubscribeTasks();
      unsubscribeBlocks();
    };
  }, []);

  const activeTaskIds = resolveActiveTaskIds(activeBlock);
  const linkedTasks = activeTaskIds
    .map((taskId) => tasksById.get(taskId))
    .filter((task): task is TaskNode => Boolean(task));

  const availableTasks = useMemo(() => (
    [...tasksById.values()].filter((task) => (
      task.status !== 'completed'
      && task.status !== 'cancelled'
      && !activeTaskIds.includes(task.id)
    ))
  ), [activeTaskIds, tasksById]);

  useEffect(() => {
    if (!selectedTaskId && availableTasks[0]) {
      setSelectedTaskId(availableTasks[0].id);
    }
    if (selectedTaskId && !availableTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(availableTasks[0]?.id ?? '');
    }
  }, [availableTasks, selectedTaskId]);

  if (!activeBlock) {
    return (
      <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务关联</h3>
        <p className="mt-2 text-sm text-[#78716C] dark:text-[#A8A29E]">开始时间块后可在这里增删关联任务。</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务关联</h3>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">运行中可追加或移除关联任务。</p>
        </div>
        <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
          {linkedTasks.length} 个任务
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {linkedTasks.length > 0 ? linkedTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center justify-between rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#3F3F46]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
              <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{task.status}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void getTaskTimerService().removeTaskFromBlock(task.id);
              }}
              className="rounded-lg border border-[#E7E5E4] px-2.5 py-1 text-xs text-[#57534E] dark:border-[#3F3F46] dark:text-[#D6D3D1]"
            >
              移除
            </button>
          </div>
        )) : (
          <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">当前还没有关联任务。</p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <select
          value={selectedTaskId}
          onChange={(event) => setSelectedTaskId(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#44403C] dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#E7E5E4]"
        >
          <option value="">选择任务</option>
          {availableTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTaskId}
          onClick={() => {
            if (!selectedTaskId) return;
            void getTaskTimerService().addTaskToBlock(selectedTaskId);
          }}
          className="shrink-0 whitespace-nowrap rounded-xl bg-[#C75B3A] px-3 py-2 text-center text-sm font-medium text-white min-w-[88px] disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
        >
          关联任务
        </button>
      </div>
    </section>
  );
}
