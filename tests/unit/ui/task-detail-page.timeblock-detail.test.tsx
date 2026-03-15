import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const navigateMock = vi.fn();

const getTaskMock = vi.fn<(id: string) => Promise<TaskNode | null>>();
const listTasksMock = vi.fn<(includeCancelled?: boolean) => Promise<TaskNode[]>>();
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
const startBlockForTaskMock = vi.fn();

const getEventsMock = vi.fn<
  () => Promise<Array<{ id: string; content: string; createdAt: string; type?: string }>>
>();
let currentTaskId = 'task-1';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useParams: () => ({ taskId: currentTaskId }),
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
    cancelTask: vi.fn(),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    pauseBlock: pauseBlockMock,
  }),
  getTaskTimerService: () => ({
    calculateSpentMinutes: calculateSpentMinutesMock,
    startBlockForTask: startBlockForTaskMock,
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
    currentTaskId = 'task-1';
    navigateMock.mockReset();
    startBlockForTaskMock.mockReset();
    startBlockForTaskMock.mockResolvedValue(null);
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === 'task-2') {
        return makeTask({
          id: 'task-2',
          title: '切换后的任务 B',
          estimatedMinutes: 30,
          status: 'pending',
          createdAt: 30,
          updatedAt: 30,
        });
      }

      return makeTask({ status: 'in_progress', createdAt: 20, updatedAt: 20 });
    });
    listTasksMock.mockResolvedValue([
      makeTask({
        id: 'task-root',
        title: '优先收口 DAG 根节点',
        status: 'pending',
        createdAt: 10,
        updatedAt: 10,
      }),
      makeTask({
        id: 'task-1',
        title: '深度工作：EventLog 模块实现',
        status: 'in_progress',
        createdAt: 20,
        updatedAt: 20,
      }),
      makeTask({
        id: 'task-2',
        title: '切换后的任务 B',
        estimatedMinutes: 30,
        status: 'pending',
        createdAt: 30,
        updatedAt: 30,
      }),
    ]);
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
    window.history.replaceState({}, '', '/tasks/block/block-1?from=today');
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

  it('renders current root guidance with DAG link（详情页复用当前根节点规则）', async () => {
    mockMatchMedia(true);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-current-root-card')).toHaveTextContent('优先收口 DAG 根节点');
    expect(screen.getByTestId('task-current-root-link')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-dag-link')).toBeInTheDocument();
  });

  it('starts countdown with task estimated minutes instead of hardcoded 25（开始计时时使用任务预估分钟数）', async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findByText('时间块详情');

    await waitFor(() => {
      expect(screen.getByTestId('task-countdown-custom-trigger')).toHaveTextContent('120m');
    });

    fireEvent.click(screen.getByText('开始计时'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-1', { mode: 'countdown', minutes: 120 });
    });
  });

  it('resets timer config after switching to another task（切换任务后重置为新任务的初始计时配置）', async () => {
    mockMatchMedia(false);
    const { rerender } = render(<TaskDetailPage />);

    await screen.findByText('时间块详情');

    fireEvent.click(screen.getByTestId('task-mode-countup'));
    expect(screen.getByTestId('task-mode-countup')).toHaveAttribute('aria-pressed', 'true');

    currentTaskId = 'task-2';
    rerender(<TaskDetailPage />);

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith('task-2');
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-mode-countdown')).toHaveAttribute('aria-pressed', 'true');
    });

    expect(screen.getByTestId('task-countdown-custom-trigger')).toHaveTextContent('30m');

    fireEvent.click(screen.getByText('开始计时'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-2', { mode: 'countdown', minutes: 30 });
    });
  });

  it('hides stale timer actions while next task is still loading（切换任务加载中不允许沿用旧配置启动）', async () => {
    mockMatchMedia(false);
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === 'task-2') {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return makeTask({
          id: 'task-2',
          title: '切换后的任务 B',
          estimatedMinutes: 30,
          status: 'pending',
          createdAt: 30,
          updatedAt: 30,
        });
      }

      return makeTask({ status: 'in_progress', createdAt: 20, updatedAt: 20 });
    });

    const { rerender } = render(<TaskDetailPage />);

    await screen.findByText('时间块详情');
    fireEvent.click(screen.getByTestId('task-mode-countup'));

    currentTaskId = 'task-2';
    rerender(<TaskDetailPage />);

    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('开始计时')).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('task-countdown-custom-trigger')).toHaveTextContent('30m');
    });

    fireEvent.click(screen.getByText('开始计时'));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-2', { mode: 'countdown', minutes: 30 });
    });
  });
});
