import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const navigateMock = vi.fn();

let tasksState: TaskNode[] = [];

function cloneTask(task: TaskNode | null): TaskNode | null {
  return task ? structuredClone(task) : null;
}

function cloneTasks(tasks: TaskNode[]): TaskNode[] {
  return structuredClone(tasks);
}

const getTaskMock = vi.fn<(id: string) => Promise<TaskNode | null>>(async (id) => {
  return cloneTask(tasksState.find((task) => task.id === id) ?? null);
});

const listTasksMock = vi.fn<(includeCancelled?: boolean) => Promise<TaskNode[]>>(async () => {
  return cloneTasks(tasksState);
});

const addDependencyMock = vi.fn<
  (taskId: string, depTaskId: string, type: 'soft' | 'hard') => Promise<TaskNode | null>
>(async (taskId, depTaskId, type) => {
  const task = tasksState.find((item) => item.id === taskId);
  if (!task) return null;

  const existing = task.dependsOn.find((dependency) => dependency.taskId === depTaskId);
  task.dependsOn = existing
    ? task.dependsOn.map((dependency) => (dependency.taskId === depTaskId ? { ...dependency, type } : dependency))
    : [...task.dependsOn, { taskId: depTaskId, type }];
  task.updatedAt += 1;

  return cloneTask(task);
});

const removeDependencyMock = vi.fn<(taskId: string, depTaskId: string) => Promise<TaskNode | null>>(async (taskId, depTaskId) => {
  const task = tasksState.find((item) => item.id === taskId);
  if (!task) return null;

  task.dependsOn = task.dependsOn.filter((dependency) => dependency.taskId !== depTaskId);
  task.updatedAt += 1;

  return cloneTask(task);
});

const onTaskChangeMock = vi.fn(() => () => {});
const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});
const pauseBlockMock = vi.fn<() => Promise<void>>();
const calculateSpentMinutesMock = vi.fn<(taskId: string) => Promise<number>>();
const getEventsMock = vi.fn<() => Promise<Array<{ id: string; content: string; createdAt: string; type?: string }>>>();

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
    onTaskChange: onTaskChangeMock,
    getAvailableTransitions: vi.fn(),
    getChildTasks: vi.fn(async () => []),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
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

function makeTask(overrides: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title'>): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: '',
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    timeBlockIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date('2026-03-07T09:00:00+08:00').getTime();
  const end = start + 25 * 60_000;
  return {
    id: 'block-1',
    startId: 'block-1',
    name: '专注块',
    note: '',
    startTime: start,
    endTime: end,
    ...overrides,
  } as TimeBlock;
}

function renderPage(isDesktop = true) {
  mockMatchMedia(isDesktop);
  render(<TaskDetailPage />);
}

describe('TaskDetailPage DAG visibility issue #395', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    tasksState = [
      makeTask({
        id: 'task-1',
        title: '实现折叠交互',
        dependsOn: [{ taskId: 'task-2', type: 'hard' }],
        timeBlockIds: ['block-1'],
      }),
      makeTask({
        id: 'task-2',
        title: '补图投影集成',
        dependsOn: [{ taskId: 'task-4', type: 'hard' }],
      }),
      makeTask({
        id: 'task-3',
        title: '联调详情页',
        dependsOn: [{ taskId: 'task-1', type: 'hard' }],
      }),
      makeTask({
        id: 'task-4',
        title: '梳理 DAG 根节点',
      }),
    ];

    getTaskMock.mockClear();
    listTasksMock.mockClear();
    addDependencyMock.mockClear();
    removeDependencyMock.mockClear();
    onTaskChangeMock.mockClear();

    loadTimeBlocksMock.mockReset();
    loadTimeBlocksMock.mockResolvedValue([makeBlock()]);
    loadActiveBlockMock.mockReset();
    loadActiveBlockMock.mockResolvedValue(null);
    onBlockChangeMock.mockClear();
    pauseBlockMock.mockReset();
    pauseBlockMock.mockResolvedValue();

    calculateSpentMinutesMock.mockReset();
    calculateSpentMinutesMock.mockResolvedValue(15);
    getEventsMock.mockReset();
    getEventsMock.mockResolvedValue([]);
  });

  it('renders dependency graph and supports collapse / expand upstream from current task', async () => {
    renderPage();

    expect(await screen.findByText('依赖图')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-4')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-node-task-3')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-edge-edge:task-1->task-3:hard')).toBeInTheDocument();
    expect(within(screen.getByTestId('task-dag-node-task-4')).getByTestId('task-dag-badge-visible-current-root-task-4')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('task-dag-toggle-upstream-task-1'));

    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-node-task-4')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-dag-node-task-2')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('task-dag-node-task-1')).toHaveTextContent('已隐藏 2 项');
    expect(screen.getByTestId('task-dag-node-task-3')).toHaveTextContent('已隐藏 2 项');
    expect(within(screen.getByTestId('task-dag-node-task-1')).getByTestId('task-dag-badge-visible-current-root-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-toggle-upstream-task-1')).toHaveTextContent('展开上游');

    fireEvent.click(screen.getByTestId('task-dag-toggle-upstream-task-1'));

    await waitFor(() => {
      expect(screen.getByTestId('task-dag-node-task-4')).toBeInTheDocument();
      expect(screen.getByTestId('task-dag-node-task-2')).toBeInTheDocument();
    });
  });

  it('collapses an intermediate node upstream and keeps descendant summaries stable', async () => {
    renderPage(false);

    expect(await screen.findByText('依赖图')).toBeInTheDocument();
    expect(screen.getByTestId('task-dag-toggle-upstream-task-4')).toBeDisabled();
    fireEvent.click(screen.getByTestId('task-dag-toggle-upstream-task-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-node-task-4')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('task-dag-node-task-2')).toHaveTextContent('已隐藏 1 项');
    expect(screen.getByTestId('task-dag-node-task-1')).toHaveTextContent('已隐藏 1 项');
    expect(screen.getByTestId('task-dag-node-task-3')).toHaveTextContent('已隐藏 1 项');
  });

  it('disables current-root guidance in the detail panel when the source graph is cyclic', async () => {
    tasksState = [
      makeTask({
        id: 'task-1',
        title: '循环 A',
        dependsOn: [{ taskId: 'task-2', type: 'hard' }],
        timeBlockIds: ['block-1'],
      }),
      makeTask({
        id: 'task-2',
        title: '循环 B',
        dependsOn: [{ taskId: 'task-1', type: 'hard' }],
      }),
    ];

    renderPage();

    expect(await screen.findByText('依赖图')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('task-dag-toggle-upstream-task-1')).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId('task-dag-toggle-upstream-task-1'));

    await waitFor(() => {
      expect(screen.queryByTestId('task-dag-node-task-2')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByTestId('task-dag-root-summary')).toHaveTextContent('当前可见根：无');
    expect(screen.getByTestId('task-dag-root-summary')).toHaveTextContent('真实当前根：无');
    expect(screen.getByText('检测到循环依赖，当前根节点引导按真实图停用，仅展示可见结构。')).toBeInTheDocument();
    expect(screen.queryByTestId('task-dag-badge-visible-current-root-task-1')).not.toBeInTheDocument();
  });
});
