import { useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTaskService } from '@/lib/services';
import { loadTaskDependencySnapshot } from '@/lib/services/task.service';
import type { TaskNode } from '@/lib/types/task';
import { PerfTrace } from '@/lib/utils/perf-trace';

export function isPrestartSelectableTask(task: TaskNode): boolean {
  return task.status === 'pending' || task.status === 'in_progress' || task.status === 'suspended';
}

export function usePrestartSelectableTasks(): TaskNode[] {
  const [selectableTasks, setSelectableTasks] = useState<TaskNode[]>([]);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();

    const loadSelectableTasks = async (trigger: 'mount' | 'task-change') => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const trace = new PerfTrace('usePrestartSelectableTasks loadSelectableTasks', {
        requestId,
        trigger,
      });
      try {
        const snapshot = await loadTaskDependencySnapshot(taskService, true, {
          candidateTaskFilter: isPrestartSelectableTask,
        });
        trace.step('load-task-dependency-snapshot', {
          hardBlockedCount: snapshot.hardBlockedTaskIds.size,
          taskCount: snapshot.tasks.length,
        });
        const candidates = snapshot.tasks.filter(isPrestartSelectableTask);
        const selectableTaskIds = new Set(
          candidates
            .filter((task) => !snapshot.hardBlockedTaskIds.has(task.id))
            .map((task) => task.id),
        );
        trace.step('filter-selectable-candidates', {
          candidateCount: candidates.length,
          selectableCount: selectableTaskIds.size,
        });
        if (disposed || requestId !== loadRequestIdRef.current) {
          trace.finish({
            candidateCount: candidates.length,
            outcome: 'stale',
            requestId,
            selectableCount: selectableTaskIds.size,
          });
          return;
        }
        setSelectableTasks(candidates.filter((task) => selectableTaskIds.has(task.id)));
        trace.step('apply-state', {
          selectableCount: selectableTaskIds.size,
        });
        trace.finish({
          candidateCount: candidates.length,
          outcome: 'applied',
          requestId,
          selectableCount: selectableTaskIds.size,
        });
      } catch (error) {
        trace.fail(error, { requestId });
        throw error;
      }
    };

    void loadSelectableTasks('mount');
    const unsubscribe = taskService.onTaskChange(() => {
      void loadSelectableTasks('task-change');
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return selectableTasks;
}

interface PrestartTaskSelectionListProps {
  tasks: TaskNode[];
  selectedTaskIds: string[];
  onSelectedTaskIdsChange(taskIds: string[]): void;
  listTestId: string;
  itemTestIdPrefix: string;
  emptyLabel: string;
  className?: string;
  maxVisibleTasks?: number;
  overflowSelectLabel?: string;
}

function resolvePrestartTaskStatusLabel(task: TaskNode, selected: boolean): string {
  if (selected) {
    return '已选';
  }
  if (task.status === 'in_progress') {
    return '进行中';
  }
  if (task.status === 'suspended') {
    return '已挂起';
  }
  return '待办';
}

export function PrestartTaskSelectionList({
  tasks,
  selectedTaskIds,
  onSelectedTaskIdsChange,
  listTestId,
  itemTestIdPrefix,
  emptyLabel,
  className,
  maxVisibleTasks,
  overflowSelectLabel,
}: PrestartTaskSelectionListProps) {
  const selectedTaskIdSet = new Set(selectedTaskIds);
  const [overflowSelection, setOverflowSelection] = useState('');
  const visibleTasks = maxVisibleTasks ? tasks.slice(0, maxVisibleTasks) : tasks;
  const overflowTasks = maxVisibleTasks ? tasks.slice(maxVisibleTasks) : [];

  const toggleTask = (taskId: string) => {
    const selected = selectedTaskIdSet.has(taskId);
    onSelectedTaskIdsChange(
      selected
        ? selectedTaskIds.filter((value) => value !== taskId)
        : [...selectedTaskIds, taskId],
    );
  };

  useEffect(() => {
    setOverflowSelection('');
  }, [selectedTaskIds, tasks]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-[#E7E5E4] bg-white/40 px-3 py-2 text-[12px] text-[#78716C] dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08] dark:text-[#A8A29E]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      data-testid={listTestId}
      className={className ?? 'space-y-2 rounded-[12px] border border-[#E7E5E4] bg-white/55 p-2 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]'}
    >
      {visibleTasks.map((task) => {
        const selected = selectedTaskIdSet.has(task.id);
        return (
          <button
            key={task.id}
            type="button"
            data-testid={`${itemTestIdPrefix}${task.id}`}
            aria-pressed={selected}
            onClick={() => toggleTask(task.id)}
            className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[12px] transition-colors ${
              selected
                ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                : 'bg-white/70 text-[#57534E] hover:bg-[#F5F0ED] dark:bg-[#120F0D]/70 dark:text-[#D6D3D1] dark:hover:bg-[#292524]'
            }`}
          >
            <span className="truncate">{task.title}</span>
            <span className="ml-3 shrink-0 text-[11px]">
              {resolvePrestartTaskStatusLabel(task, selected)}
            </span>
          </button>
        );
      })}
      {overflowTasks.length > 0 ? (
        <label className="block space-y-1 text-[12px] text-[#57534E] dark:text-[#D6D3D1]">
          <span className="flex items-center justify-between gap-2">
            <span>{overflowSelectLabel ?? 'More tasks / 更多任务'}</span>
            <span className="text-[11px] text-[#A8A29E]">{overflowTasks.length} 个候选</span>
          </span>
          <Select
            value={overflowSelection}
            onValueChange={(nextTaskId) => {
              setOverflowSelection(nextTaskId);
              if (!nextTaskId) {
                return;
              }
              toggleTask(nextTaskId);
              setOverflowSelection('');
            }}
          >
            <SelectTrigger
              aria-label={overflowSelectLabel ?? '更多任务'}
              className="w-full rounded-[10px] border-[#E7E5E4] bg-white px-3 py-2 text-[12px] dark:border-[#FFFFFF20] dark:bg-[#120F0D] dark:text-[#D6D3D1]"
            >
              <SelectValue placeholder="从下拉里查看和选择更多任务" />
            </SelectTrigger>
            <SelectContent>
              {overflowTasks.map((task) => {
                const selected = selectedTaskIdSet.has(task.id);
                const statusLabel = resolvePrestartTaskStatusLabel(task, selected);
                return (
                  <SelectItem key={task.id} value={task.id}>
                    {`${selected ? '[已选] ' : ''}${task.title} · ${statusLabel}`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </label>
      ) : null}
    </div>
  );
}
