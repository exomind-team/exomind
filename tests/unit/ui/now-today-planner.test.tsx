import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import type { TodayPlannerSnapshot } from '@/lib/types/event';

const getTodayPlannerMock = vi.fn();
const createPlannedBlockMock = vi.fn();
const updatePlannedBlockMock = vi.fn();
const reorderPlannedBlocksMock = vi.fn();
const startPlannedBlockMock = vi.fn();
const deletePlannedBlockMock = vi.fn();
const loadTimeBlocksMock = vi.fn();
const loadActiveBlockMock = vi.fn();
const onBlockChangeMock = vi.fn(() => () => {});
const getTaskMock = vi.fn();
const onTaskChangeMock = vi.fn(() => () => {});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTodayPlannerService: () => ({
    getTodayPlanner: getTodayPlannerMock,
    createPlannedBlock: createPlannedBlockMock,
    updatePlannedBlock: updatePlannedBlockMock,
    reorderPlannedBlocks: reorderPlannedBlocksMock,
    startPlannedBlock: startPlannedBlockMock,
    deletePlannedBlock: deletePlannedBlockMock,
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
  }),
  getTaskService: () => ({
    getTask: getTaskMock,
    onTaskChange: onTaskChangeMock,
  }),
}));

function createSnapshot(): TodayPlannerSnapshot {
  return {
    date: '2026-03-26',
    blocks: [
      {
        id: 'plan-1',
        date: '2026-03-26',
        type: 'work',
        title: 'Deep Work',
        plannedStartAt: new Date('2026-03-26T09:00:00+08:00').getTime(),
        plannedDurationMinutes: 50,
        linkedTaskIds: ['task-a'],
        order: 0,
        createdAt: new Date('2026-03-26T08:00:00+08:00').getTime(),
        updatedAt: new Date('2026-03-26T08:00:00+08:00').getTime(),
        status: 'pending',
      },
      {
        id: 'plan-2',
        date: '2026-03-26',
        type: 'rest',
        title: 'Lunch Reset',
        plannedStartAt: new Date('2026-03-26T12:30:00+08:00').getTime(),
        plannedDurationMinutes: 30,
        linkedTaskIds: [],
        order: 1,
        createdAt: new Date('2026-03-26T08:10:00+08:00').getTime(),
        updatedAt: new Date('2026-03-26T08:10:00+08:00').getTime(),
        status: 'pending',
      },
    ],
  };
}

describe('NowTodayTab Today Planner（今日计划器）', () => {
  beforeEach(() => {
    getTodayPlannerMock.mockReset();
    createPlannedBlockMock.mockReset();
    updatePlannedBlockMock.mockReset();
    reorderPlannedBlocksMock.mockReset();
    startPlannedBlockMock.mockReset();
    deletePlannedBlockMock.mockReset();
    loadTimeBlocksMock.mockReset();
    loadActiveBlockMock.mockReset();
    onBlockChangeMock.mockClear();
    getTaskMock.mockReset();
    onTaskChangeMock.mockClear();

    getTodayPlannerMock.mockResolvedValue(createSnapshot());
    createPlannedBlockMock.mockResolvedValue(undefined);
    updatePlannedBlockMock.mockResolvedValue(undefined);
    reorderPlannedBlocksMock.mockResolvedValue(createSnapshot());
    startPlannedBlockMock.mockResolvedValue(undefined);
    deletePlannedBlockMock.mockResolvedValue(undefined);
    loadTimeBlocksMock.mockResolvedValue([]);
    loadActiveBlockMock.mockResolvedValue(null);
    getTaskMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets users create, edit, reorder, start, and delete planned work/rest blocks（支持创建、编辑、重排、开始、删除今日计划块）', async () => {
    render(<NowTodayTab />);

    await waitFor(() => {
      expect(screen.getByText('Deep Work')).toBeInTheDocument();
      expect(screen.getByText('Lunch Reset')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Wrap Up' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'rest' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '18:30' } });
    fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '添加计划块' }));

    await waitFor(() => {
      expect(createPlannedBlockMock).toHaveBeenCalledWith(expect.objectContaining({
        date: expect.any(String),
        type: 'rest',
        title: 'Wrap Up',
        plannedDurationMinutes: 20,
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑计划块：Deep Work' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Deep Work Revised' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(updatePlannedBlockMock).toHaveBeenCalledWith('plan-1', expect.objectContaining({
        title: 'Deep Work Revised',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: '上移计划块：Lunch Reset' }));
    await waitFor(() => {
      expect(reorderPlannedBlocksMock).toHaveBeenCalledWith('2026-03-26', ['plan-2', 'plan-1']);
    });

    fireEvent.click(screen.getByRole('button', { name: '开始计划块：Deep Work' }));
    await waitFor(() => {
      expect(startPlannedBlockMock).toHaveBeenCalledWith('plan-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '删除计划块：Lunch Reset' }));
    await waitFor(() => {
      expect(deletePlannedBlockMock).toHaveBeenCalledWith('plan-2');
    });
  });
});
