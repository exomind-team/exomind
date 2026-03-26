import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { getTaskService, getTimeBlockService, getTodayPlannerService } from '@/lib/services';
import {
  resolveActiveBlockTaskIds,
  resolveTimeBlockRelatedTaskIds,
  type ActiveBlockData,
  type CreatePlannedTimeBlockInput,
  type PlannedTimeBlockType,
  type TimeBlock,
  type TodayPlannerBlock,
  type TodayPlannerSnapshot,
  type UpdatePlannedTimeBlockInput,
} from '@/lib/types/event';
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

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function formatPlannerClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildPlannerTimestamp(dateKey: string, timeValue: string): number {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const [hours, minutes] = timeValue.split(':').map((part) => Number.parseInt(part, 10));
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0).getTime();
}

function buildDefaultTimeValue(now: Date): string {
  const rounded = new Date(now.getTime());
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const nextMinutes = minutes <= 30 ? 30 : 60;
  rounded.setMinutes(nextMinutes, 0, 0);
  return formatTimeValue(rounded.getTime());
}

function formatPlannerRange(block: TodayPlannerBlock): string {
  const end = block.plannedStartAt + (block.plannedDurationMinutes * 60_000);
  return `${formatPlannerClock(block.plannedStartAt)} - ${formatPlannerClock(end)} · ${block.plannedDurationMinutes} 分钟`;
}

function resolvePlannerTypeLabel(blockType: PlannedTimeBlockType): string {
  return blockType === 'work' ? '工作块' : '休息块';
}

function resolvePlannerStatusLabel(status: TodayPlannerBlock['status']): string {
  if (status === 'active') return '进行中';
  if (status === 'completed') return '已完成';
  return '待开始';
}

interface PlannerFormState {
  title: string;
  type: PlannedTimeBlockType;
  timeValue: string;
  durationMinutes: string;
  note: string;
}

function buildDefaultPlannerForm(now: Date): PlannerFormState {
  return {
    title: '',
    type: 'work',
    timeValue: buildDefaultTimeValue(now),
    durationMinutes: '50',
    note: '',
  };
}

export function NowTodayTab() {
  const [plannerSnapshot, setPlannerSnapshot] = useState<TodayPlannerSnapshot | null>(null);
  const [plannerLoading, setPlannerLoading] = useState(true);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [plannerForm, setPlannerForm] = useState<PlannerFormState>(() => buildDefaultPlannerForm(new Date()));
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [plannerSubmitting, setPlannerSubmitting] = useState(false);
  const [completedBlocks, setCompletedBlocks] = useState<TimeBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [historyLoading, setHistoryLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const refreshHistoryRef = useRef<((forceRefreshTasks?: boolean) => Promise<void>) | null>(null);
  const completedBlocksRef = useRef<TimeBlock[]>([]);
  const activeBlockRef = useRef<ActiveBlockData | null>(null);
  const completedBlocksSignatureRef = useRef('');
  const activeBlockSignatureRef = useRef('null');
  const taskIdsSignatureRef = useRef('');
  const todayDate = formatDateKey(now);

  useEffect(() => {
    const todayPlannerService = getTodayPlannerService();
    let disposed = false;

    const loadPlanner = async () => {
      setPlannerLoading(true);
      setPlannerError(null);
      try {
        const snapshot = await todayPlannerService.getTodayPlanner(todayDate);
        if (disposed) {
          return;
        }
        setPlannerSnapshot(snapshot);
      } catch (error) {
        if (disposed) {
          return;
        }
        setPlannerError(error instanceof Error ? error.message : '加载今日计划失败');
      } finally {
        if (!disposed) {
          setPlannerLoading(false);
        }
      }
    };

    void loadPlanner();
    return () => {
      disposed = true;
    };
  }, [todayDate]);

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
      setHistoryLoading(false);
    };

    refreshHistoryRef.current = loadSnapshot;
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
      refreshHistoryRef.current = null;
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

  const plannerBlocks = plannerSnapshot?.blocks ?? [];

  const resetPlannerForm = () => {
    setPlannerForm(buildDefaultPlannerForm(new Date()));
    setEditingBlockId(null);
  };

  const refreshPlanner = async () => {
    setPlannerError(null);
    const snapshot = await getTodayPlannerService().getTodayPlanner(todayDate);
    setPlannerSnapshot(snapshot);
  };

  const handlePlannerSubmit = async () => {
    const trimmedTitle = plannerForm.title.trim();
    const durationMinutes = Number.parseInt(plannerForm.durationMinutes, 10);
    if (!trimmedTitle) {
      setPlannerError('标题不能为空');
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setPlannerError('时长必须大于 0');
      return;
    }

    const basePayload = {
      date: todayDate,
      type: plannerForm.type,
      title: trimmedTitle,
      plannedStartAt: buildPlannerTimestamp(todayDate, plannerForm.timeValue),
      plannedDurationMinutes: durationMinutes,
      linkedTaskIds: [],
    };

    setPlannerSubmitting(true);
    setPlannerError(null);
    try {
      if (editingBlockId) {
        await getTodayPlannerService().updatePlannedBlock(editingBlockId, {
          ...basePayload,
          note: plannerForm.note.trim() || null,
        } satisfies UpdatePlannedTimeBlockInput);
      } else {
        await getTodayPlannerService().createPlannedBlock({
          ...basePayload,
          note: plannerForm.note.trim() || undefined,
        } satisfies CreatePlannedTimeBlockInput);
      }
      await refreshPlanner();
      resetPlannerForm();
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : '保存今日计划失败');
    } finally {
      setPlannerSubmitting(false);
    }
  };

  const handleEditBlock = (block: TodayPlannerBlock) => {
    setEditingBlockId(block.id);
    setPlannerForm({
      title: block.title,
      type: block.type,
      timeValue: formatTimeValue(block.plannedStartAt),
      durationMinutes: String(block.plannedDurationMinutes),
      note: block.note ?? '',
    });
  };

  const handleMoveBlock = async (blockId: string, direction: -1 | 1) => {
    const currentIndex = plannerBlocks.findIndex((block) => block.id === blockId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= plannerBlocks.length) {
      return;
    }

    const nextIds = plannerBlocks.map((block) => block.id);
    const [moved] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, moved);
    try {
      await getTodayPlannerService().reorderPlannedBlocks(todayDate, nextIds);
      await refreshPlanner();
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : '重排今日计划失败');
    }
  };

  const handleStartBlock = async (blockId: string) => {
    try {
      await getTodayPlannerService().startPlannedBlock(blockId);
      await Promise.all([
        refreshPlanner(),
        refreshHistoryRef.current?.(true) ?? Promise.resolve(),
      ]);
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : '开始计划块失败');
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    try {
      await getTodayPlannerService().deletePlannedBlock(blockId);
      await refreshPlanner();
      if (editingBlockId === blockId) {
        resetPlannerForm();
      }
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : '删除计划块失败');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-[#E7E5E4] bg-white/90 p-4 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">今日计划</p>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">手动安排今天的工作块和休息块，然后直接开始执行。</p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span>标题</span>
            <input
              aria-label="标题"
              value={plannerForm.title}
              onChange={(event) => setPlannerForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D]"
              placeholder="例如：Deep Work / 午休"
            />
          </label>

          <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span>类型</span>
            <select
              aria-label="类型"
              value={plannerForm.type}
              onChange={(event) => setPlannerForm((prev) => ({ ...prev, type: event.target.value as PlannedTimeBlockType }))}
              className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D]"
            >
              <option value="work">工作块</option>
              <option value="rest">休息块</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span>开始时间</span>
            <input
              aria-label="开始时间"
              type="time"
              value={plannerForm.timeValue}
              onChange={(event) => setPlannerForm((prev) => ({ ...prev, timeValue: event.target.value }))}
              className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D]"
            />
          </label>

          <label className="space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span>时长（分钟）</span>
            <input
              aria-label="时长（分钟）"
              type="number"
              min={1}
              value={plannerForm.durationMinutes}
              onChange={(event) => setPlannerForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
              className="w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D]"
            />
          </label>
        </div>

        <label className="mt-3 block space-y-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
          <span>备注</span>
          <textarea
            value={plannerForm.note}
            onChange={(event) => setPlannerForm((prev) => ({ ...prev, note: event.target.value }))}
            className="min-h-[84px] w-full rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D]"
            placeholder="可选：记录这个块的目的或边界"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={plannerSubmitting}
            onClick={() => void handlePlannerSubmit()}
            className="rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#B14D2F] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {editingBlockId ? '保存修改' : '添加计划块'}
          </button>
          {editingBlockId ? (
            <button
              type="button"
              onClick={resetPlannerForm}
              className="rounded-full border border-[#E7E5E4] px-4 py-2 text-sm text-[#57534E] transition-colors hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
            >
              取消编辑
            </button>
          ) : null}
        </div>

        {plannerError ? (
          <p className="mt-3 text-xs text-[#C75B3A]" role="alert">{plannerError}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {plannerLoading ? (
            <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">加载今日计划...</p>
          ) : plannerBlocks.length === 0 ? (
            <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">今天还没有计划块。</p>
          ) : (
            plannerBlocks.map((block, index) => (
              <div
                key={block.id}
                className="rounded-2xl border border-[#E7E5E4] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{block.title}</p>
                      <span className={`rounded-full px-2 py-1 text-[11px] ${
                        block.type === 'work'
                          ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                          : 'bg-[#ECFDF5] text-[#047857] dark:bg-[#10261D] dark:text-[#6EE7B7]'
                      }`}>
                        {resolvePlannerTypeLabel(block.type)}
                      </span>
                      <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                        {resolvePlannerStatusLabel(block.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{formatPlannerRange(block)}</p>
                    {block.note ? (
                      <p className="mt-2 text-xs text-[#57534E] dark:text-[#D6D3D1]">{block.note}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`编辑计划块：${block.title}`}
                      onClick={() => handleEditBlock(block)}
                      className="rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs text-[#57534E] transition-colors hover:bg-[#F5F0ED] dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      aria-label={`上移计划块：${block.title}`}
                      disabled={index === 0}
                      onClick={() => void handleMoveBlock(block.id, -1)}
                      className="rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs text-[#57534E] transition-colors hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      aria-label={`下移计划块：${block.title}`}
                      disabled={index === plannerBlocks.length - 1}
                      onClick={() => void handleMoveBlock(block.id, 1)}
                      className="rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs text-[#57534E] transition-colors hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      aria-label={`开始计划块：${block.title}`}
                      disabled={block.status === 'active'}
                      onClick={() => void handleStartBlock(block.id)}
                      className="rounded-full bg-[#1C1917] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#FAFAF9] dark:text-[#1C1917] dark:hover:bg-[#E7E5E4]"
                    >
                      开始
                    </button>
                    <button
                      type="button"
                      aria-label={`删除计划块：${block.title}`}
                      onClick={() => void handleDeleteBlock(block.id)}
                      className="rounded-full border border-[#F5D0C5] px-3 py-1.5 text-xs text-[#C75B3A] transition-colors hover:bg-[#FFF7ED] dark:border-[#5A2C20] dark:text-[#FDBA74] dark:hover:bg-[#2A231B]"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">今日记录</p>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">执行后的时间块会继续留在这里。</p>
        </div>

        {historyLoading ? (
          <p className="px-1 py-4 text-sm text-[#78716C] dark:text-[#A8A29E]">加载今日时间块...</p>
        ) : view.items.length === 0 ? (
          <p className="px-1 py-4 text-sm text-[#78716C] dark:text-[#A8A29E]">今天还没有时间块记录。</p>
        ) : (
          view.items.map((item) => (
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
          ))
        )}
      </section>
    </div>
  );
}
