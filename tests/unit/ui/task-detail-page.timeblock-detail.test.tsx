import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const navigateMock = vi.fn();

const getTaskMock = vi.fn<(id: string) => Promise<TaskNode | null>>();
const listTasksMock = vi.fn<(includeAbandoned?: boolean) => Promise<TaskNode[]>>();
const addDependencyMock = vi.fn<(taskId: string, depTaskId: string, type: 'soft' | 'hard') => Promise<TaskNode | null>>();
const removeDependencyMock = vi.fn<(taskId: string, depTaskId: string) => Promise<TaskNode | null>>();
const getAvailableTransitionsMock = vi.fn<(id: string) => Promise<Array<TaskNode['status']>>>();
const getChildTasksMock = vi.fn<(parentId: string) => Promise<TaskNode[]>>();
const checkDependenciesMetMock = vi.fn<(taskId: string) => Promise<{ met: boolean; blocking: Array<{ taskId: string; type: 'soft' | 'hard'; status: TaskNode['status'] }> }>>();
const onTaskChangeMock = vi.fn(() => () => {});

const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});
const pauseBlockMock = vi.fn<() => Promise<void>>();

const calculateSpentMinutesMock = vi.fn<(taskId: string) => Promise<number>>();

const getEventsMock = vi.fn<
  () => Promise<Array<{ id: string; content: string; createdAt: string; type?: string }>>
>();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useParams: () => ({ taskId: 'task-1' }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    getTask: getTaskMock,
    listTasks: listTasksMock,
    addDependency: addDependencyMock,
    removeDependency: removeDependencyMock,
    getAvailableTransitions: getAvailableTransitionsMock,
    getChildTasks: getChildTasksMock,
    checkDependenciesMet: checkDependenciesMetMock,
    onTaskChange: onTaskChangeMock,
    transitionTask: vi.fn(),
    updateTask: vi.fn(),
    abandonTask: vi.fn(),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    pauseBlock: pauseBlockMock,
  }),
  getTaskTimerService: () => ({
    calculateSpentMinutes: calculateSpentMinutesMock,
    startBlockForTask: vi.fn(),
  }),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: () => ({
    getEvents: getEventsMock,
  }),
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '深度工作：EventLog 模块实现',
    description: '实现时间块详情页首版',
    status: 'completed',
    priority: 'high',
    dependsOn: [],
    tags: ['frontend'],
    estimatedMinutes: 120,
    timeBlockIds: ['block-1'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date('2026-03-06T09:00:00+08:00').getTime();
  const end = new Date('2026-03-06T10:30:00+08:00').getTime();
  return {
    id: 'block-1',
    startId: 'block-1',
    endId: 'block-1-end',
    name: '深度工作：EventLog 模块实现',
    note: '中途依赖冲突，修复后恢复推进',
    tags: new Set(['block_feedback']),
    startTime: start,
    endTime: end,
    ...overrides,
  };
}

describe('TaskDetailPage timeblock detail layout（时间块详情布局）', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getTaskMock.mockResolvedValue(makeTask());
    listTasksMock.mockResolvedValue([makeTask()]);
    addDependencyMock.mockResolvedValue(makeTask());
    removeDependencyMock.mockResolvedValue(makeTask());
    getAvailableTransitionsMock.mockResolvedValue(['in_progress']);
    getChildTasksMock.mockResolvedValue([]);
    checkDependenciesMetMock.mockResolvedValue({ met: true, blocking: [] });
    loadTimeBlocksMock.mockResolvedValue([makeBlock()]);
    loadActiveBlockMock.mockResolvedValue(null);
    calculateSpentMinutesMock.mockResolvedValue(90);
    getEventsMock.mockResolvedValue([
      {
        id: 'event-1',
        createdAt: new Date('2026-03-06T10:31:00+08:00').toISOString(),
        type: 'agent_feedback',
        content: '## AI 反馈：深度工作：EventLog 模块实现\n\n**做得好的** 主流程完成清晰\n\n**卡住的地方** 依赖冲突\n\n**建议** 拆分组件并补测试',
      },
    ]);
  });

  it('renders mobile detail sections and legacy timer testids（移动端详情结构与兼容 testid）', async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith('task-1');
    });

    expect(await screen.findByText('时间块详情')).toBeInTheDocument();
    expect(screen.getByText('概览')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
    expect(screen.getAllByText('AI 总结').length).toBeGreaterThan(0);
    expect(screen.getByText('计划 vs 实际')).toBeInTheDocument();
    expect(screen.getByTestId('task-timer-card')).toBeInTheDocument();
    expect(screen.getByTestId('task-mode-countup')).toBeInTheDocument();
    expect(screen.getByTestId('task-mode-countdown')).toBeInTheDocument();
    expect(screen.getByTestId('task-pause-button')).toBeInTheDocument();
  });

  it('renders desktop two-column timeblock detail（桌面端双列时间块详情）', async () => {
    mockMatchMedia(true);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    expect(await screen.findByText('任务 > 今日 > 时间块详情')).toBeInTheDocument();
    expect(screen.getAllByText('深度工作：EventLog 模块实现').length).toBeGreaterThan(0);
    expect(screen.getByText('事件时间线')).toBeInTheDocument();
    expect(screen.getByText('洞察')).toBeInTheDocument();
    expect(screen.getByText('操作')).toBeInTheDocument();
  });
});
