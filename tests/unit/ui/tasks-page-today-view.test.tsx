import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage } from '@/ui/app/pages/TasksPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/config/task-create-success-action', () => ({
  getTaskCreateSuccessAction: vi.fn(() => 'refocus'),
  setTaskCreateSuccessAction: vi.fn((value: string) => value),
  subscribeTaskCreateSuccessActionChanges: vi.fn(() => () => {}),
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
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
    status: 'pending',
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

describe('TasksPage current layout（任务页当前布局）', () => {
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
        status: 'pending',
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
  });

  it('renders top navigation links for timeline and dag', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    expect(screen.getByText('时间线').closest('a')).toHaveAttribute('to', '/tasks/timeline');
    expect(screen.getByText('DAG').closest('a')).toHaveAttribute('to', '/tasks/dag');
  });

  it('keeps quick add input visible on the tasks page', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    expect(screen.getByPlaceholderText('添加任务与描述...')).toBeInTheDocument();
  });

  it('renders clickable links for current visible tasks', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });

    expect(await screen.findByTestId('tasks-page-task-link-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-page-task-link-task-2')).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

