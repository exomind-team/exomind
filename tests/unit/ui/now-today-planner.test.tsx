import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NowTodayTab } from '@/ui/app/components/NowTodayTab';
import type {
  TodayPlannerSegment,
  TodayPlannerWindow,
} from '@/lib/types/event';

const getTaskMock = vi.fn();
const listTasksMock = vi.fn();
const checkDependenciesMetMock = vi.fn();
const onTaskChangeMock = vi.fn(() => () => {});
const loadTimeBlocksMock = vi.fn();
const loadActiveBlockMock = vi.fn();
const onBlockChangeMock = vi.fn(() => () => {});
const getTodayPlannerMock = vi.fn();
const createSchedulingWindowMock = vi.fn();
const updatePlannedSegmentMock = vi.fn();
const startWorkSegmentMock = vi.fn();
const reflowSchedulingWindowMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    getTask: getTaskMock,
    listTasks: listTasksMock,
    checkDependenciesMet: checkDependenciesMetMock,
    onTaskChange: onTaskChangeMock,
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
  }),
  getTodayPlannerService: () => ({
    getTodayPlanner: getTodayPlannerMock,
    createSchedulingWindow: createSchedulingWindowMock,
    updatePlannedSegment: updatePlannedSegmentMock,
    startWorkSegment: startWorkSegmentMock,
    reflowSchedulingWindow: reflowSchedulingWindowMock,
  }),
}));

function plannerTs(clock: string): number {
  return new Date(`2026-03-27T${clock}:00+08:00`).getTime();
}

function plannerTsOn(dateKey: string, clock: string): number {
  return new Date(`${dateKey}T${clock}:00+08:00`).getTime();
}

function makeSegment(
  input: Partial<TodayPlannerSegment> & Pick<TodayPlannerSegment, 'id' | 'windowId' | 'kind' | 'title' | 'plannedStartAt' | 'plannedEndAt' | 'order'>,
): TodayPlannerSegment {
  return {
    id: input.id,
    windowId: input.windowId,
    kind: input.kind,
    title: input.title,
    plannedStartAt: input.plannedStartAt,
    plannedEndAt: input.plannedEndAt,
    linkedTaskIds: input.linkedTaskIds ?? [],
    order: input.order,
    createdAt: input.createdAt ?? input.plannedStartAt,
    updatedAt: input.updatedAt ?? input.plannedStartAt,
    status: input.status ?? 'pending',
    breakKind: input.breakKind,
    sourceTimeBlockId: input.sourceTimeBlockId,
  };
}

function makeWindow(
  input: Partial<TodayPlannerWindow> & Pick<TodayPlannerWindow, 'id' | 'plannedStartAt' | 'plannedEndAt' | 'segments'>,
): TodayPlannerWindow {
  return {
    id: input.id,
    date: input.date ?? '2026-03-27',
    title: input.title,
    plannedStartAt: input.plannedStartAt,
    plannedEndAt: input.plannedEndAt,
    rhythmPreset: input.rhythmPreset ?? {
      key: 'pomodoro_25_5',
      label: '25 / 5',
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 20,
      longBreakAfterWorkSegments: 4,
    },
    segments: input.segments,
    createdAt: input.createdAt ?? input.plannedStartAt,
    updatedAt: input.updatedAt ?? input.plannedStartAt,
  };
}

describe('NowTodayTab Today Planner timeline（时间线版今日计划器）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-03-27T09:00:00+08:00'));

    getTaskMock.mockReset();
    listTasksMock.mockReset();
    checkDependenciesMetMock.mockReset();
    onTaskChangeMock.mockClear();
    loadTimeBlocksMock.mockReset();
    loadActiveBlockMock.mockReset();
    onBlockChangeMock.mockReset();
    getTodayPlannerMock.mockReset();
    createSchedulingWindowMock.mockReset();
    updatePlannedSegmentMock.mockReset();
    startWorkSegmentMock.mockReset();
    reflowSchedulingWindowMock.mockReset();

    loadTimeBlocksMock.mockResolvedValue([]);
    loadActiveBlockMock.mockResolvedValue(null);
    getTodayPlannerMock.mockResolvedValue({ date: '2026-03-27', windows: [] });
    listTasksMock.mockResolvedValue([]);
    checkDependenciesMetMock.mockResolvedValue({ met: true, blocking: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a 15-minute timeline and creates a scheduling window from drag selection（15 分钟时间线拖拽创建可调度区间）', async () => {
    const user = userEvent.setup();
    const createdWindow = makeWindow({
      id: 'window-1',
      title: '上午深度工作',
      plannedStartAt: plannerTs('08:15'),
      plannedEndAt: plannerTs('09:15'),
      segments: [
        makeSegment({
          id: 'segment-work-1',
          windowId: 'window-1',
          kind: 'work',
          title: 'Deep Work 1',
          plannedStartAt: plannerTs('08:15'),
          plannedEndAt: plannerTs('08:55'),
          order: 0,
        }),
        makeSegment({
          id: 'segment-break-1',
          windowId: 'window-1',
          kind: 'break',
          breakKind: 'short',
          title: 'Short Break',
          plannedStartAt: plannerTs('08:55'),
          plannedEndAt: plannerTs('09:00'),
          order: 1,
        }),
        makeSegment({
          id: 'segment-work-2',
          windowId: 'window-1',
          kind: 'work',
          title: 'Deep Work 2',
          plannedStartAt: plannerTs('09:00'),
          plannedEndAt: plannerTs('09:15'),
          order: 2,
        }),
      ],
    });

    getTodayPlannerMock
      .mockResolvedValueOnce({ date: '2026-03-27', windows: [] })
      .mockResolvedValue({ date: '2026-03-27', windows: [createdWindow] });
    createSchedulingWindowMock.mockResolvedValue(createdWindow);

    render(<NowTodayTab />);

    const slot0815 = await screen.findByTestId('planner-slot-08:15');
    const slot0900 = screen.getByTestId('planner-slot-09:00');

    fireEvent.mouseDown(slot0815);
    fireEvent.mouseEnter(slot0900);
    fireEvent.mouseUp(slot0900);

    expect(await screen.findByTestId('today-planner-window-draft')).toHaveTextContent('08:15');
    expect(screen.getByTestId('today-planner-window-draft')).toHaveTextContent('09:15');
    expect(screen.getByRole('combobox', { name: '节奏预设' }).tagName).not.toBe('SELECT');

    fireEvent.change(screen.getByLabelText('区间标题'), {
      target: { value: '上午深度工作' },
    });
    await user.click(screen.getByRole('combobox', { name: '节奏预设' }));
    await user.click(await screen.findByRole('option', { name: '45 / 10 · Focus' }));
    fireEvent.click(screen.getByRole('button', { name: '创建可调度区间' }));

    await waitFor(() => {
      expect(createSchedulingWindowMock).toHaveBeenCalledWith({
        date: '2026-03-27',
        title: '上午深度工作',
        plannedStartAt: plannerTs('08:15'),
        plannedEndAt: plannerTs('09:15'),
        rhythmPresetKey: 'focus_45_10',
      });
    });

    expect(await screen.findByTestId('planner-window-window-1')).toBeInTheDocument();
    expect(screen.getByText('Deep Work 1')).toBeInTheDocument();
    expect(screen.getByText('Short Break')).toBeInTheDocument();
  });

  it('starts a work segment without exposing or writing task associations（UI 不展示或编辑任务关联；RT 合同另验）', async () => {
    const snapshotWindow = makeWindow({
      id: 'window-2',
      title: '下午推进',
      plannedStartAt: plannerTs('13:00'),
      plannedEndAt: plannerTs('14:00'),
      segments: [
        makeSegment({
          id: 'segment-work-3',
          windowId: 'window-2',
          kind: 'work',
          title: 'Deep Work A',
          plannedStartAt: plannerTs('13:00'),
          plannedEndAt: plannerTs('13:45'),
          order: 0,
          linkedTaskIds: ['task-a'],
        }),
        makeSegment({
          id: 'segment-break-3',
          windowId: 'window-2',
          kind: 'break',
          breakKind: 'short',
          title: 'Short Break',
          plannedStartAt: plannerTs('13:45'),
          plannedEndAt: plannerTs('14:00'),
          order: 1,
        }),
      ],
    });
    getTodayPlannerMock.mockResolvedValue({ date: '2026-03-27', windows: [snapshotWindow] });
    startWorkSegmentMock.mockResolvedValue({
      startId: 'active-segment-work-3',
      name: 'Deep Work A',
      mode: 'countdown',
      elapsed: 0,
      startTime: plannerTs('13:00'),
      paused: false,
      phase: 'running',
      version: 1,
      lastTransitionAt: plannerTs('13:00'),
      taskIds: ['task-a'],
      taskAssociationLog: [],
      targetMinutes: 45,
      sourcePlannedBlockId: 'segment-work-3',
    });

    render(<NowTodayTab />);

    fireEvent.click(await screen.findByTestId('planner-segment-segment-work-3'));

    expect(await screen.findByTestId('planner-segment-inspector')).toBeInTheDocument();

    expect(screen.queryByTestId('planner-segment-task-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/任务/)).not.toBeInTheDocument();
    expect(listTasksMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '开始这个工作片段' }));

    await waitFor(() => {
      expect(startWorkSegmentMock).toHaveBeenCalledWith('segment-work-3');
    });
    expect(updatePlannedSegmentMock).not.toHaveBeenCalled();
    expect(getTaskMock).not.toHaveBeenCalled();
  });

  it('hides stored task associations from the Alpha planner（Alpha 计划视图不显示任务关联）', async () => {
    const snapshotWindow = makeWindow({
      id: 'window-overflow',
      title: '计划区间测试',
      plannedStartAt: plannerTs('15:00'),
      plannedEndAt: plannerTs('16:00'),
      segments: [
        makeSegment({
          id: 'segment-work-overflow',
          windowId: 'window-overflow',
          kind: 'work',
          title: '任务过多工作块',
          plannedStartAt: plannerTs('15:00'),
          plannedEndAt: plannerTs('15:45'),
          order: 0,
          linkedTaskIds: Array.from({ length: 12 }, (_, index) => `task-${index + 1}`),
        }),
        makeSegment({
          id: 'segment-break-overflow',
          windowId: 'window-overflow',
          kind: 'break',
          breakKind: 'short',
          title: 'Short Break',
          plannedStartAt: plannerTs('15:45'),
          plannedEndAt: plannerTs('16:00'),
          order: 1,
        }),
      ],
    });

    getTodayPlannerMock.mockResolvedValue({ date: '2026-03-27', windows: [snapshotWindow] });

    render(<NowTodayTab />);

    fireEvent.click(await screen.findByTestId('planner-segment-segment-work-overflow'));

    expect(await screen.findByTestId('planner-segment-inspector')).toBeInTheDocument();

    expect(screen.queryByTestId('planner-segment-task-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/个任务|关联任务/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '更多任务' })).not.toBeInTheDocument();
    expect(listTasksMock).not.toHaveBeenCalled();
  });

  it('reflows a work segment ending at midnight using the next-day timestamp（跨午夜重算会把 00:00 解释为次日）', async () => {
    const snapshotWindow = makeWindow({
      id: 'window-midnight',
      title: '夜间冲刺',
      plannedStartAt: plannerTs('23:15'),
      plannedEndAt: plannerTsOn('2026-03-28', '00:30'),
      segments: [
        makeSegment({
          id: 'segment-work-midnight',
          windowId: 'window-midnight',
          kind: 'work',
          title: '夜间工作块',
          plannedStartAt: plannerTs('23:15'),
          plannedEndAt: plannerTsOn('2026-03-28', '00:00'),
          order: 0,
        }),
        makeSegment({
          id: 'segment-break-midnight',
          windowId: 'window-midnight',
          kind: 'break',
          breakKind: 'short',
          title: 'Short Break',
          plannedStartAt: plannerTsOn('2026-03-28', '00:00'),
          plannedEndAt: plannerTsOn('2026-03-28', '00:30'),
          order: 1,
        }),
      ],
    });

    getTodayPlannerMock.mockResolvedValue({ date: '2026-03-27', windows: [snapshotWindow] });
    reflowSchedulingWindowMock.mockResolvedValue(snapshotWindow);

    render(<NowTodayTab />);

    fireEvent.click(await screen.findByTestId('planner-segment-segment-work-midnight'));
    expect(await screen.findByTestId('planner-segment-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重算当前区间' }));

    await waitFor(() => {
      expect(reflowSchedulingWindowMock).toHaveBeenCalledWith('window-midnight', {
        anchorSegmentId: 'segment-work-midnight',
        actualEndAt: plannerTsOn('2026-03-28', '00:00'),
      });
    });
  });

  it('keeps the full-day timeline scrollable, auto-focuses occupied slots, and hides today history（保留全天滚动、默认聚焦有区间时段，并隐藏今日记录）', async () => {
    const snapshotWindow = makeWindow({
      id: 'window-focused',
      title: '下午推进',
      plannedStartAt: plannerTs('13:00'),
      plannedEndAt: plannerTs('14:00'),
      segments: [
        makeSegment({
          id: 'segment-work-focused',
          windowId: 'window-focused',
          kind: 'work',
          title: 'Focused Work',
          plannedStartAt: plannerTs('13:00'),
          plannedEndAt: plannerTs('14:00'),
          order: 0,
        }),
      ],
    });

    getTodayPlannerMock.mockResolvedValue({ date: '2026-03-27', windows: [snapshotWindow] });

    render(<NowTodayTab />);

    const scrollViewport = await screen.findByTestId('today-planner-scroll-viewport');
    expect(await screen.findByTestId('planner-window-window-focused')).toBeInTheDocument();
    expect(screen.getByTestId('planner-slot-13:00')).toBeInTheDocument();
    expect(screen.getByTestId('planner-slot-00:00')).toBeInTheDocument();
    expect(screen.getByTestId('planner-slot-23:45')).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollViewport.scrollTop).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: '展开全天' })).toBeNull();
    expect(screen.queryByRole('button', { name: '聚焦有时间块时段' })).toBeNull();
    expect(screen.queryByText('今日记录')).toBeNull();
    expect(screen.queryByText('执行后的时间块会继续留在这里。')).toBeNull();
  });

  it('refreshes planner date after midnight even without an active block（无活跃块时跨午夜也会刷新今日日期）', async () => {
    vi.setSystemTime(new Date('2026-03-27T23:59:00+08:00'));
    getTodayPlannerMock.mockImplementation(async (date: string) => ({ date, windows: [] }));

    render(<NowTodayTab />);

    await waitFor(() => {
      expect(getTodayPlannerMock).toHaveBeenCalledWith('2026-03-27');
    });

    getTodayPlannerMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    await waitFor(() => {
      expect(getTodayPlannerMock).toHaveBeenCalledWith('2026-03-28');
    });
  });
});
