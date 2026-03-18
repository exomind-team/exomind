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

    await screen.findByText('运行中可追加或移除关联任务。');
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
    expect(screen.getByText('任务一')).toBeInTheDocument();

    fireEvent.click(screen.getByText('关联任务'));
    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-2');
    });

    fireEvent.click(screen.getByText('移除'));
    await waitFor(() => {
      expect(removeTaskFromBlockMock).toHaveBeenCalledWith('task-1');
    });
  });

  it('keeps newly associated task when a stale task-change reload resolves later', async () => {
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
      taskIds: ['task-1', 'task-2'],
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
});
