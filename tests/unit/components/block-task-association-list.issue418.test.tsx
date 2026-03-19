import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';

type MockTask = {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';
};

const loadActiveBlockMock = vi.fn();
const listTasksMock = vi.fn();
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

describe('BlockTaskAssociationList issue-418', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blockChangeHandler = null;
    taskChangeHandler = null;
    checkDependenciesMetMock.mockResolvedValue({ met: true, blocking: [] });
  });

  it('renders running association controls and calls add/remove actions', async () => {
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

    await screen.findByText('任务关联');
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
    expect(screen.getByText('任务一')).toBeInTheDocument();
    expect(screen.queryByText('运行中可追加或移除关联任务。')).toBeNull();
    expect(screen.queryByText('in_progress')).toBeNull();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'task-2' } });
    fireEvent.click(screen.getByText('关联任务'));
    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-2');
    });

    fireEvent.click(screen.getByText('移除'));
    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-1');
    });
  });

  it('keeps newly associated tasks when active block falls back to association log', async () => {
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

    fireEvent.click(screen.getByText('关联任务'));

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

    await screen.findByRole('combobox');

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['选择任务', '可追加任务']));
    expect(options).not.toEqual(expect.arrayContaining(['已关联任务', '被硬依赖阻塞的任务']));
  });

  it('shows an inline error when addTaskToBlock rejects', async () => {
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

    await screen.findByText('任务关联');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'task-2' } });
    fireEvent.click(screen.getByText('关联任务'));

    expect(await screen.findByText('所选任务存在未完成的硬依赖，当前不能关联。')).toBeInTheDocument();
  });
});
