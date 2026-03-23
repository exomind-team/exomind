import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const navigateMock = vi.fn();

let tasksState: TaskNode[] = [];
let addDependencyFailure: Error | null = null;
let removeDependencyFailure: Error | null = null;

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
  if (addDependencyFailure) throw addDependencyFailure;

  const task = tasksState.find((item) => item.id === taskId);
  if (!task) return null;

  const target = tasksState.find((item) => item.id === depTaskId);
  if (!target) throw new Error(`Dependency target ${depTaskId} not found`);

  const existing = task.dependsOn.find((dependency) => dependency.taskId === depTaskId);
  task.dependsOn = existing
    ? task.dependsOn.map((dependency) => (dependency.taskId === depTaskId ? { ...dependency, type } : dependency))
    : [...task.dependsOn, { taskId: depTaskId, type }];
  task.updatedAt += 1;

  return cloneTask(task);
});

const removeDependencyMock = vi.fn<(taskId: string, depTaskId: string) => Promise<TaskNode | null>>(async (taskId, depTaskId) => {
  if (removeDependencyFailure) throw removeDependencyFailure;

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

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '任务详情：依赖关系 MVP',
    description: '在详情页增加依赖关系卡片',
    status: 'pending',
    priority: 'high',
    dependsOn: [],
    tags: ['issue-398'],
    estimatedMinutes: 60,
    timeBlockIds: ['block-1'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date('2026-03-07T09:00:00+08:00').getTime();
  const end = new Date('2026-03-07T10:00:00+08:00').getTime();
  return {
    id: 'block-1',
    startId: 'block-1',
    endId: 'block-1-end',
    name: '任务详情：依赖关系 MVP',
    note: 'issue 398 P0',
    tags: new Set(['block_feedback']),
    startTime: start,
    endTime: end,
    ...overrides,
  };
}

function renderPage(isDesktop = true) {
  mockMatchMedia(isDesktop);
  render(<TaskDetailPage />);
}

describe('TaskDetailPage dependencies issue #398 P0', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    addDependencyFailure = null;
    removeDependencyFailure = null;

    tasksState = [
      makeTask({
        id: 'task-1',
        title: '实现依赖关系卡片',
        dependsOn: [{ taskId: 'task-2', type: 'soft' }],
      }),
      makeTask({
        id: 'task-2',
        title: '补 task.service 单测',
        status: 'in_progress',
        timeBlockIds: [],
      }),
      makeTask({
        id: 'task-3',
        title: '联调任务详情页',
        status: 'completed',
        dependsOn: [{ taskId: 'task-1', type: 'hard' }],
        timeBlockIds: [],
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

  it('renders current dependencies and reverse dependencies（渲染当前依赖与反向依赖）', async () => {
    renderPage(false);

    expect(await screen.findByText('依赖关系')).toBeInTheDocument();

    const currentItem = await screen.findByTestId('dependency-item-task-2');
    expect(within(currentItem).getByText('补 task.service 单测')).toBeInTheDocument();
    expect(within(currentItem).getByText('进行中')).toBeInTheDocument();
    expect(within(currentItem).getByDisplayValue('soft')).toBeInTheDocument();

    const reverseItem = screen.getByTestId('reverse-dependency-item-task-3');
    expect(within(reverseItem).getByText('联调任务详情页')).toBeInTheDocument();
    expect(within(reverseItem).getByText('状态：已完成')).toBeInTheDocument();
    expect(within(reverseItem).getByText('硬依赖')).toBeInTheDocument();
  });

  it('adds a hard dependency（新增 hard 依赖）', async () => {
    tasksState[0].dependsOn = [];
    renderPage();

    await screen.findByTestId('dependency-add-task-select');
    expect(screen.getByTestId('dependency-current-empty')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('dependency-add-task-select'), { target: { value: 'task-2' } });
    fireEvent.change(screen.getByTestId('dependency-add-type-select'), { target: { value: 'hard' } });
    fireEvent.click(screen.getByTestId('dependency-add-button'));

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-1', 'task-2', 'hard');
    });

    const currentItem = await screen.findByTestId('dependency-item-task-2');
    expect(within(currentItem).getByDisplayValue('hard')).toBeInTheDocument();
    expect(screen.queryByTestId('dependency-current-empty')).not.toBeInTheDocument();
  });

  it('renders disabled candidates and prevents blocked selections（渲染禁用候选并阻止选择）', async () => {
    tasksState[0].dependsOn = [];
    tasksState.push(makeTask({
      id: 'task-4',
      title: '归档旧方案',
      status: 'cancelled',
      timeBlockIds: [],
    }));
    renderPage();

    const taskSelect = await screen.findByTestId('dependency-add-task-select');

    expect(within(taskSelect).queryByRole('option', { name: '实现依赖关系卡片 · 待办' })).not.toBeInTheDocument();
    expect(within(taskSelect).getByRole('option', { name: '补 task.service 单测 · 进行中' })).not.toBeDisabled();
    expect(within(taskSelect).getByRole('option', { name: '联调任务详情页 · 已完成 · 会形成循环依赖' })).toBeDisabled();
    expect(within(taskSelect).getByRole('option', { name: '归档旧方案 · 已取消 · 任务已取消' })).toBeDisabled();

    fireEvent.change(taskSelect, { target: { value: 'task-3' } });

    expect(screen.getByTestId('dependency-add-button')).toBeDisabled();
    expect(screen.getByTestId('dependency-add-task-disabled-reason')).toHaveTextContent('会形成循环依赖');
    expect(addDependencyMock).not.toHaveBeenCalled();
  });

  it('switches dependency type from soft to hard（切换依赖类型）', async () => {
    renderPage();

    const typeSelect = await screen.findByTestId('dependency-type-task-2');
    fireEvent.change(typeSelect, { target: { value: 'hard' } });

    await waitFor(() => {
      expect(addDependencyMock).toHaveBeenCalledWith('task-1', 'task-2', 'hard');
    });

    const currentItem = await screen.findByTestId('dependency-item-task-2');
    expect(within(currentItem).getByDisplayValue('hard')).toBeInTheDocument();
  });

  it('removes dependency（删除依赖）', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('dependency-remove-task-2'));

    await waitFor(() => {
      expect(removeDependencyMock).toHaveBeenCalledWith('task-1', 'task-2');
    });

    expect(await screen.findByTestId('dependency-current-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('dependency-item-task-2')).not.toBeInTheDocument();
  });

  it('shows readable error when dependency service throws not found（服务报错时展示基础错误提示）', async () => {
    tasksState[0].dependsOn = [];
    addDependencyFailure = new Error('Dependency target task-99 not found');
    renderPage();

    await screen.findByTestId('dependency-add-task-select');
    fireEvent.change(screen.getByTestId('dependency-add-task-select'), { target: { value: 'task-2' } });
    fireEvent.click(screen.getByTestId('dependency-add-button'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('依赖任务不存在，请刷新后重试');
  });
});
