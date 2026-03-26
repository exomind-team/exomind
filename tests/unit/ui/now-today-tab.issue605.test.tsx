import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

const getTaskMock = vi.fn();
const onTaskChangeMock = vi.fn(() => () => {});
const loadTimeBlocksMock = vi.fn();
const loadActiveBlockMock = vi.fn();
const onBlockChangeMock = vi.fn();
const getTodayPlannerMock = vi.fn();

let blockChangeHandler: ((block: ActiveBlockData | null) => void) | null = null;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    getTask: getTaskMock,
    onTaskChange: onTaskChangeMock,
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
  }),
  getTodayPlannerService: () => ({
    getTodayPlanner: getTodayPlannerMock,
    createPlannedBlock: vi.fn(),
    updatePlannedBlock: vi.fn(),
    reorderPlannedBlocks: vi.fn(),
    startPlannedBlock: vi.fn(),
    deletePlannedBlock: vi.fn(),
  }),
}));

function makeTask(input: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title'>): TaskNode {
  const now = Date.UTC(2026, 2, 19, 2, 0, 0);
  return {
    id: input.id,
    title: input.title,
    status: input.status ?? 'pending',
    priority: input.priority ?? 'medium',
    dependsOn: input.dependsOn ?? [],
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    description: input.description,
    estimatedMinutes: input.estimatedMinutes,
    completedAt: input.completedAt,
    dueAt: input.dueAt,
    source: input.source,
    parentId: input.parentId,
    doneCondition: input.doneCondition,
    timeBlockIds: input.timeBlockIds,
  };
}

function makeBlock(input: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'name' | 'startId' | 'endId' | 'startTime' | 'endTime'>): TimeBlock {
  return {
    id: input.id,
    name: input.name,
    startId: input.startId,
    endId: input.endId,
    startTime: input.startTime,
    endTime: input.endTime,
    tags: input.tags ?? new Set(['block_feedback']),
    note: input.note,
    taskIds: input.taskIds,
    taskStatusOutcomes: input.taskStatusOutcomes,
    taskAssociationLog: input.taskAssociationLog,
  };
}

describe('NowTodayTab issue-605（活跃时间块快照闪烁修复）', () => {
  beforeEach(() => {
    getTaskMock.mockReset();
    onTaskChangeMock.mockClear();
    loadTimeBlocksMock.mockReset();
    loadActiveBlockMock.mockReset();
    onBlockChangeMock.mockReset();
    getTodayPlannerMock.mockReset();
    blockChangeHandler = null;
    getTodayPlannerMock.mockResolvedValue({
      date: '2026-03-26',
      blocks: [],
    });

    onBlockChangeMock.mockImplementation((callback: (block: ActiveBlockData | null) => void) => {
      blockChangeHandler = callback;
      return () => {};
    });
  });

  afterEach(() => {
    blockChangeHandler = null;
  });

  it('does not reload all blocks for duplicate active-block updates but refreshes after block end（重复活跃快照不整页重载，结束后才刷新时间块列表）', async () => {
    const now = Date.now();
    const completedBlock = makeBlock({
      id: 'done-1',
      startId: 'done-1',
      endId: 'done-1-end',
      name: '已完成时间块',
      startTime: now - 3_600_000,
      endTime: now - 1_800_000,
      taskIds: ['task-a'],
    });
    const activeBlock: ActiveBlockData = {
      startId: 'active-1',
      name: '进行中时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: now - 600_000,
      paused: false,
      phase: 'running',
      version: 3,
      lastTransitionAt: now - 600_000,
      taskIds: ['task-b'],
      taskAssociationLog: [],
    };
    const taskMap = new Map<string, TaskNode>([
      ['task-a', makeTask({ id: 'task-a', title: '任务甲' })],
      ['task-b', makeTask({ id: 'task-b', title: '任务乙' })],
    ]);

    loadTimeBlocksMock.mockResolvedValue([completedBlock]);
    loadActiveBlockMock.mockResolvedValue(activeBlock);
    getTaskMock.mockImplementation(async (taskId: string) => taskMap.get(taskId) ?? null);

    render(<NowTodayTab />);

    await waitFor(() => {
      expect(screen.getByText('进行中时间块')).toBeInTheDocument();
    });

    expect(loadTimeBlocksMock).toHaveBeenCalledTimes(1);
    expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('加载今日时间块...')).not.toBeInTheDocument();

    await act(async () => {
      blockChangeHandler?.({
        ...activeBlock,
        taskAssociationLog: [...activeBlock.taskAssociationLog],
      });
    });

    expect(loadTimeBlocksMock).toHaveBeenCalledTimes(1);
    expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('加载今日时间块...')).not.toBeInTheDocument();

    await act(async () => {
      blockChangeHandler?.(null);
    });

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalledTimes(2);
    });
  });
});
