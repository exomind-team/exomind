import { NotepadText, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import { resolveActiveBlockTaskIds, type ActiveBlockData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { PrestartTaskSelectionList, usePrestartSelectableTasks } from '@/ui/app/components/prestart-task-selection';
import { PerfTrace } from '@/lib/utils/perf-trace';

function hasHardBlockingDependency(
  dependencyCheck: { blocking: Array<{ type: 'soft' | 'hard' }> },
): boolean {
  return dependencyCheck.blocking.some((dependency) => dependency.type === 'hard');
}

function formatAssociationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('hard dependencies not met')) {
    return '所选任务存在未完成的硬依赖，当前不能关联。';
  }
  return '关联任务失败，请稍后重试。';
}

interface BlockTaskAssociationListProps {
  prestartSelectedTaskIds?: string[];
  onPrestartSelectedTaskIdsChange?: (taskIds: string[]) => void;
}

export function BlockTaskAssociationList(props: BlockTaskAssociationListProps = {}) {
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [hardBlockedTaskIds, setHardBlockedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [associationError, setAssociationError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const prestartSelectableTasks = usePrestartSelectableTasks();

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();
    const timeBlockService = getTimeBlockService();

    const loadSnapshot = async () => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const trace = new PerfTrace('BlockTaskAssociationList loadSnapshot', {
        requestId,
        trigger: 'mount-or-task-change',
      });

      try {
        const [nextBlock, tasks] = await Promise.all([
          timeBlockService.loadActiveBlock(),
          taskService.listTasks(true),
        ]);
        trace.step('load-active-block-and-tasks', {
          hasActiveBlock: Boolean(nextBlock),
          linkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
          taskCount: tasks.length,
        });
        const dependencyChecks = await Promise.all(tasks.map(async (task) => {
          try {
            const result = await taskService.checkDependenciesMet(task.id);
            return [task.id, hasHardBlockingDependency(result)] as const;
          } catch {
            return [task.id, true] as const;
          }
        }));
        const hardBlockedTaskIds = dependencyChecks
          .filter(([, isBlocked]) => isBlocked)
          .map(([taskId]) => taskId);
        trace.step('check-task-dependencies', {
          taskCount: tasks.length,
          hardBlockedCount: hardBlockedTaskIds.length,
        });
        if (disposed || requestId !== loadRequestIdRef.current) {
          trace.finish({
            outcome: 'stale',
            hasActiveBlock: Boolean(nextBlock),
            linkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
            taskCount: tasks.length,
            hardBlockedCount: hardBlockedTaskIds.length,
          });
          return;
        }
        setActiveBlock(nextBlock);
        setTasksById(new Map(tasks.map((task) => [task.id, task])));
        setHardBlockedTaskIds(new Set(hardBlockedTaskIds));
        trace.step('apply-state', {
          linkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
        });
        trace.finish({
          outcome: 'applied',
          hasActiveBlock: Boolean(nextBlock),
          linkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
          taskCount: tasks.length,
          hardBlockedCount: hardBlockedTaskIds.length,
        });
      } catch (error) {
        trace.fail(error);
        throw error;
      }
    };

    const loadTasksOnly = async (nextBlock: ActiveBlockData | null) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const trace = new PerfTrace('BlockTaskAssociationList loadTasksOnly', {
        incomingLinkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
        incomingStartId: nextBlock?.startId ?? null,
        requestId,
        trigger: 'block-change',
      });

      try {
        const tasks = await taskService.listTasks(true);
        trace.step('list-tasks', {
          taskCount: tasks.length,
        });
        const dependencyChecks = await Promise.all(tasks.map(async (task) => {
          try {
            const result = await taskService.checkDependenciesMet(task.id);
            return [task.id, hasHardBlockingDependency(result)] as const;
          } catch {
            return [task.id, true] as const;
          }
        }));
        const hardBlockedTaskIds = dependencyChecks
          .filter(([, isBlocked]) => isBlocked)
          .map(([taskId]) => taskId);
        trace.step('check-task-dependencies', {
          taskCount: tasks.length,
          hardBlockedCount: hardBlockedTaskIds.length,
        });
        if (disposed || requestId !== loadRequestIdRef.current) {
          trace.finish({
            outcome: 'stale',
            incomingLinkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
            taskCount: tasks.length,
            hardBlockedCount: hardBlockedTaskIds.length,
          });
          return;
        }
        setActiveBlock(nextBlock);
        setTasksById(new Map(tasks.map((task) => [task.id, task])));
        setHardBlockedTaskIds(new Set(hardBlockedTaskIds));
        trace.step('apply-state', {
          linkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
        });
        trace.finish({
          outcome: 'applied',
          incomingLinkedTaskCount: resolveActiveBlockTaskIds(nextBlock).length,
          taskCount: tasks.length,
          hardBlockedCount: hardBlockedTaskIds.length,
        });
      } catch (error) {
        trace.fail(error);
        throw error;
      }
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

  const activeTaskIds = resolveActiveBlockTaskIds(activeBlock);
  const linkedTasks = activeTaskIds
    .map((taskId) => tasksById.get(taskId))
    .filter((task): task is TaskNode => Boolean(task));

  const availableTasks = useMemo(() => (
    [...tasksById.values()].filter((task) => (
      task.status !== 'completed'
      && task.status !== 'cancelled'
      && !hardBlockedTaskIds.has(task.id)
      && !activeTaskIds.includes(task.id)
    ))
  ), [activeTaskIds, hardBlockedTaskIds, tasksById]);

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
        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联任务</h3>
        {props.onPrestartSelectedTaskIdsChange ? (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">时间块开始前即可选择可执行任务，开始后会自动关联到本次时间块。</p>
            <PrestartTaskSelectionList
              tasks={prestartSelectableTasks}
              selectedTaskIds={props.prestartSelectedTaskIds ?? []}
              onSelectedTaskIdsChange={props.onPrestartSelectedTaskIdsChange}
              listTestId="task-association-prestart-list"
              itemTestIdPrefix="task-association-prestart-task-"
              emptyLabel="当前没有可预选的关联任务。"
              className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] p-2 dark:border-[#3F3F46] dark:bg-[#120F0D]/70"
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#78716C] dark:text-[#A8A29E]">开始时间块后可在这里增删关联任务。</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联任务</h3>
        </div>
        <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
          {linkedTasks.length} 个任务
        </span>
      </div>

      <div className="mt-3 space-y-3" data-testid="task-association-content">
        <div className="space-y-2" data-testid="task-association-linked-list">
          {linkedTasks.length > 0 ? linkedTasks.map((task) => (
            <div
              key={task.id}
              className="flex min-h-[44px] items-center justify-between rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#3F3F46]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  aria-label={`打开任务详情：${task.title}`}
                  title="任务详情"
                  className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-lg text-[#57534E] transition-colors hover:bg-[#F8F5F2] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                >
                  <NotepadText size={17} />
                </Link>
                <button
                  type="button"
                  aria-label={`移除关联任务：${task.title}`}
                  title="移除关联"
                  onClick={() => {
                    setAssociationError(null);
                    void getTaskTimerService().removeTaskFromBlock(task.id).catch((error) => {
                      setAssociationError(formatAssociationError(error));
                    });
                  }}
                  className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-lg text-[#57534E] transition-colors hover:bg-[#F8F5F2] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                >
                  <X size={17} />
                </button>
              </div>
            </div>
          )) : (
            <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">当前还没有关联任务。</p>
          )}
        </div>

        <div data-testid="task-association-actions">
          <div className="flex gap-2">
            <Select
              value={selectedTaskId}
              onValueChange={setSelectedTaskId}
            >
              <SelectTrigger
                aria-label="选择任务"
                className="h-[44px] min-w-0 flex-1 rounded-xl border-[#E7E5E4] bg-white px-3 py-2 text-sm text-[#44403C] dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#E7E5E4]"
              >
                <SelectValue placeholder="选择任务" />
              </SelectTrigger>
              <SelectContent>
                {availableTasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              disabled={!selectedTaskId}
              onClick={() => {
                if (!selectedTaskId) return;
                setAssociationError(null);
                void getTaskTimerService().addTaskToBlock(selectedTaskId).catch((error) => {
                  setAssociationError(formatAssociationError(error));
                });
              }}
              className="h-[44px] min-w-[88px] shrink-0 whitespace-nowrap rounded-xl bg-[#C75B3A] px-3 py-2 text-center text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
            >
              关联任务
            </button>
          </div>
          {associationError ? (
            <p className="mt-2 text-xs text-[#C75B3A] dark:text-[#FDBA74]">{associationError}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
