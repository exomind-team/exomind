import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';

type MockTask = {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';
};

const loadActiveBlockMock = vi.fn();
const listTasksMock = vi.fn();
const listTasksWithDependencyStatusMock = vi.fn();
const checkDependenciesMetMock = vi.fn();
const addTaskToBlockMock = vi.fn();
const removeTaskFromBlockMock = vi.fn();
let blockChangeHandler: ((block: unknown) => void) | null = null;
let taskChangeHandler: (() => void) | null = null;

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: (handler: (block: unknown) => void) => {
      blockChangeHandler = handler;
      return () => {
        if (blockChangeHandler === handler) {
          blockChangeHandler = null;
        }
      };
    },
  }),
  getTaskService: () => ({
    listTasks: listTasksMock,
    listTasksWithDependencyStatus: listTasksWithDependencyStatusMock,
    checkDependenciesMet: checkDependenciesMetMock,
    onTaskChange: (handler: () => void) => {
      taskChangeHandler = handler;
      return () => {
        if (taskChangeHandler === handler) {
          taskChangeHandler = null;
        }
      };
    },
  }),
  getTaskTimerService: () => ({
    addTaskToBlock: addTaskToBlockMock,
    removeTaskFromBlock: removeTaskFromBlockMock,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: {
    children: ReactNode;
    to: string;
    params?: { taskId?: string };
    [key: string]: unknown;
  }) => {
    const href = to === '/tasks/$taskId' && params?.taskId ? `/tasks/${params.taskId}` : to;
    return <a href={href} {...props}>{children}</a>;
  },
}));

function makeTask(overrides: Partial<MockTask>): MockTask {
  return {
    id: 'task-1',
    title: '任务一',
    status: 'in_progress',
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function chooseTask(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: '选择任务' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('BlockTaskAssociationList issue-418', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blockChangeHandler = null;
    taskChangeHandler = null;
    checkDependenciesMetMock.mockResolvedValue({ met: true, blocking: [] });
    listTasksWithDependencyStatusMock.mockImplementation(async (
      includeCancelled?: boolean,
      options?: { candidateTaskFilter?: (task: MockTask) => boolean },
    ) => {
      const tasks = await listTasksMock(includeCancelled);
      const candidates = options?.candidateTaskFilter
        ? tasks.filter(options.candidateTaskFilter)
        : tasks;
      const hardBlockedTaskIds = new Set<string>();
      for (const task of candidates) {
        const result = await checkDependenciesMetMock(task.id);
        const hasHardBlock = result.blocking.some((dependency: { type: 'soft' | 'hard' }) => dependency.type === 'hard');
        if (hasHardBlock) {
          hardBlockedTaskIds.add(task.id);
        }
      }
      return { tasks, hardBlockedTaskIds };
    });
  });

  it('renders running association controls and calls add/remove actions', async () => {
    const user = userEvent.setup();
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-1'],
      taskAssociationLog: [],
    });
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '任务一', status: 'in_progress' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'pending' }),
    ]);
    addTaskToBlockMock.mockResolvedValue(undefined);
    removeTaskFromBlockMock.mockResolvedValue(undefined);

    render(<BlockTaskAssociationList />);

    await screen.findByText('关联任务');
    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksWithDependencyStatusMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
    expect(screen.getByText('任务一')).toBeInTheDocument();
    expect(screen.queryByText('运行中可追加或移除关联任务。')).toBeNull();
    expect(screen.queryByText('in_progress')).toBeNull();
    expect(screen.getByRole('link', { name: '打开任务详情：任务一' })).toHaveAttribute('href', '/tasks/task-1');

    expect(screen.getByRole('combobox', { name: '选择任务' }).tagName).not.toBe('SELECT');
    await chooseTask(user, '任务二');
    fireEvent.click(screen.getByRole('button', { name: '关联任务' }));
    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-2');
    });

    fireEvent.click(screen.getByRole('button', { name: '移除关联任务：任务一' }));
    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-1');
    });
  });

  it('applies block-only updates without reloading tasks', async () => {
    const initialBlock = {
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup' as const,
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running' as const,
      taskIds: ['task-1'],
      taskAssociationLog: [],
    };
    loadActiveBlockMock.mockResolvedValue(initialBlock);
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '任务一', status: 'in_progress' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'pending' }),
    ]);

    render(<BlockTaskAssociationList />);

    await screen.findByText('1 个任务');
    expect(listTasksMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      blockChangeHandler?.({
        ...initialBlock,
        taskIds: ['task-1', 'task-2'],
      });
    });

    expect(await screen.findByText('2 个任务')).toBeInTheDocument();
    expect(listTasksMock).toHaveBeenCalledTimes(1);
  });

  it('keeps newly associated tasks when active block falls back to association log', async () => {
    const user = userEvent.setup();
    const initialBlock = {
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup' as const,
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running' as const,
      taskIds: ['task-1'],
      taskAssociationLog: [],
    };
    const updatedBlock = {
      ...initialBlock,
      taskIds: [],
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 1, source: 'block_start' },
        { blockId: 'block-1', taskId: 'task-2', action: 'associated', timestamp: 2, source: 'manual' },
      ],
    };
    const allTasks = [
      makeTask({ id: 'task-1', title: '任务一', status: 'in_progress' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'in_progress' }),
    ];
    const staleBlockDeferred = createDeferred<typeof initialBlock>();

    loadActiveBlockMock
      .mockResolvedValueOnce(initialBlock)
      .mockReturnValueOnce(staleBlockDeferred.promise)
      .mockResolvedValueOnce(updatedBlock);
    listTasksMock.mockResolvedValue(allTasks);

    addTaskToBlockMock.mockImplementation(async () => {
      taskChangeHandler?.();
      blockChangeHandler?.(updatedBlock);
    });

    render(<BlockTaskAssociationList />);

    await screen.findByText('1 个任务');
    await screen.findByText('任务一');

    await chooseTask(user, '任务二');
    fireEvent.click(screen.getByRole('button', { name: '关联任务' }));

    await waitFor(() => {
      expect(screen.getByText('2 个任务')).toBeInTheDocument();
      expect(screen.getByText('任务二')).toBeInTheDocument();
    });

    await act(async () => {
      staleBlockDeferred.resolve(initialBlock);
      await staleBlockDeferred.promise;
    });

    expect(screen.getByText('2 个任务')).toBeInTheDocument();
    expect(screen.getByText('任务二')).toBeInTheDocument();
  });

  it('filters out already linked and hard-blocked tasks from candidate options', async () => {
    const user = userEvent.setup();
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: [],
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 1, source: 'block_start' },
      ],
    });
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '已关联任务', status: 'in_progress' }),
      makeTask({ id: 'task-2', title: '被硬依赖阻塞的任务', status: 'pending' }),
      makeTask({ id: 'task-3', title: '可追加任务', status: 'pending' }),
    ]);
    checkDependenciesMetMock.mockImplementation(async (taskId: string) => (
      taskId === 'task-2'
        ? { met: false, blocking: [{ taskId: 'dep-1', type: 'hard', status: 'pending' }] }
        : { met: true, blocking: [] }
    ));

    render(<BlockTaskAssociationList />);

    await screen.findByRole('combobox', { name: '选择任务' });
    await user.click(screen.getByRole('combobox', { name: '选择任务' }));

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['可追加任务']));
    expect(options).not.toEqual(expect.arrayContaining(['已关联任务', '被硬依赖阻塞的任务']));
  });

  it('shows an inline error when addTaskToBlock rejects', async () => {
    const user = userEvent.setup();
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '进行中时间块',
      mode: 'countup',
      elapsed: 0,
      startTime: Date.now(),
      paused: false,
      phase: 'running',
      taskIds: ['task-1'],
      taskAssociationLog: [],
    });
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '任务一', status: 'in_progress' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'pending' }),
    ]);
    addTaskToBlockMock.mockRejectedValue(new Error('Cannot associate task to active block: hard dependencies not met [dep-1]'));

    render(<BlockTaskAssociationList />);

    await screen.findByText('关联任务');
    await chooseTask(user, '任务二');
    fireEvent.click(screen.getByRole('button', { name: '关联任务' }));

    expect(await screen.findByText('所选任务存在未完成的硬依赖，当前不能关联。')).toBeInTheDocument();
  });

  it('shows prestart selectable tasks when no active block and external selection is provided', async () => {
    const onPrestartSelectedTaskIdsChange = vi.fn();
    loadActiveBlockMock.mockResolvedValue(null);
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '任务一', status: 'pending' }),
      makeTask({ id: 'task-2', title: '任务二', status: 'in_progress' }),
      makeTask({ id: 'task-3', title: '任务三', status: 'completed' }),
    ]);

    render(
      <BlockTaskAssociationList
        prestartSelectedTaskIds={['task-2']}
        onPrestartSelectedTaskIdsChange={onPrestartSelectedTaskIdsChange}
      />,
    );

    expect(await screen.findByText('时间块开始前即可选择可执行任务，开始后会自动关联到本次时间块。')).toBeInTheDocument();
    expect(listTasksWithDependencyStatusMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('task-association-prestart-task-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-association-prestart-task-task-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('task-association-prestart-task-task-3')).toBeNull();

    fireEvent.click(screen.getByTestId('task-association-prestart-task-task-1'));
    expect(onPrestartSelectedTaskIdsChange).toHaveBeenCalledWith(['task-2', 'task-1']);
  });

  it('includes suspended tasks in prestart selectable list when they are not hard-blocked', async () => {
    loadActiveBlockMock.mockResolvedValue(null);
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '待办任务', status: 'pending' }),
      makeTask({ id: 'task-2', title: '挂起任务', status: 'suspended' }),
      makeTask({ id: 'task-3', title: '已取消任务', status: 'cancelled' }),
    ]);

    render(
      <BlockTaskAssociationList
        prestartSelectedTaskIds={[]}
        onPrestartSelectedTaskIdsChange={vi.fn()}
      />,
    );

    await screen.findByText('时间块开始前即可选择可执行任务，开始后会自动关联到本次时间块。');
    expect(screen.getByTestId('task-association-prestart-task-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-association-prestart-task-task-2')).toBeInTheDocument();
    expect(screen.getByText('挂起任务')).toBeInTheDocument();
    expect(screen.getByText('已挂起')).toBeInTheDocument();
    expect(screen.queryByTestId('task-association-prestart-task-task-3')).toBeNull();
  });
});
