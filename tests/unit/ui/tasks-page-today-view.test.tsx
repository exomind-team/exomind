import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage } from '@/ui/app/pages/TasksPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    abandonTask: vi.fn(),
    transitionTask: vi.fn(),
    getAvailableTransitions: vi.fn(async () => []),
    getChildTasks: vi.fn(async () => []),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    startSync: vi.fn(async () => {}),
    stopSync: vi.fn(async () => {}),
    onTaskChange: vi.fn(() => () => {}),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: vi.fn(() => () => {}),
  }),
}));

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeBlock(overrides: { id: string; name: string; startTime: number; endTime: number; note?: string }): TimeBlock {
  return {
    id: overrides.id,
    name: overrides.name,
    startId: overrides.id,
    endId: `${overrides.id}-end`,
    note: overrides.note,
    tags: new Set(['block_feedback']),
    startTime: overrides.startTime,
    endTime: overrides.endTime,
  };
}

describe('TasksPage today view（任务页今日时间块视图）', () => {
  const morning = new Date('2026-03-06T09:00:00.000+08:00').getTime();
  const afternoon = new Date('2026-03-06T15:00:00.000+08:00').getTime();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-03-06T12:00:00.000+08:00'));
    listTasksMock.mockReset();
    loadTimeBlocksMock.mockReset();
    loadActiveBlockMock.mockReset();

    listTasksMock.mockResolvedValue([
      makeTask({
        id: 'task-1',
        title: '完成 Task List 视图设计',
        status: 'in_progress',
        timeBlockIds: ['block-1'],
        estimatedMinutes: 120,
        createdAt: 200,
        updatedAt: morning,
      }),
      makeTask({
        id: 'task-2',
        title: '实现下午编码任务',
        status: 'not_started',
        dueAt: afternoon,
        createdAt: 100,
        updatedAt: afternoon,
      }),
    ]);
    loadTimeBlocksMock.mockResolvedValue([
      makeBlock({
        id: 'block-1',
        name: '深度工作',
        startTime: morning,
        endTime: morning + 90 * 60_000,
        note: '顺利完成，比预期快 30 分钟',
      }),
      makeBlock({
        id: 'block-2',
        name: '实现下午编码任务',
        startTime: afternoon,
        endTime: afternoon + 60 * 60_000,
        note: '处理依赖问题后恢复推进',
      }),
    ]);
    loadActiveBlockMock.mockResolvedValue(null);
  });

  it('renders current root summary and badge in now view', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(await screen.findByTestId('task-current-root-card')).toHaveTextContent('实现下午编码任务');
    expect(screen.getByTestId('task-current-root-badge-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-dag-link')).toBeInTheDocument();
  });

  it('renders today timeblock layout when 今日 tab is active', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '今日' }));

    expect(await screen.findByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('上午')).toBeInTheDocument();
    expect(screen.getByText('下午')).toBeInTheDocument();
    expect(screen.getAllByText('完成 Task List 视图设计').length).toBeGreaterThan(0);
  });

  it('keeps quick add input visible in today view', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '今日' }));

    expect(screen.getByPlaceholderText('快速添加任务...')).toBeInTheDocument();
  });

  it('renders clickable links for each historical timeblock card', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '今日' }));

    expect(await screen.findByTestId('tasks-today-block-link-block-1')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-today-block-link-block-2')).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

