import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

let routeTaskId = 'task-1';

const navigateMock = vi.fn();
const getTaskMock = vi.fn<(id: string) => Promise<TaskNode | null>>();
const listTasksMock = vi.fn<(includeAbandoned?: boolean) => Promise<TaskNode[]>>();
const updateTaskMock = vi.fn<(id: string, input: { estimatedMinutes?: number }) => Promise<TaskNode | null>>();
const onTaskChangeMock = vi.fn(() => () => {});

const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});

const getEventsMock = vi.fn<
  () => Promise<Array<{ id: string; content: string; createdAt: string; type?: string }>>
>();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useParams: () => ({ taskId: routeTaskId }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    getTask: getTaskMock,
    listTasks: listTasksMock,
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    getAvailableTransitions: vi.fn(),
    getChildTasks: vi.fn(async () => []),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    onTaskChange: onTaskChangeMock,
    transitionTask: vi.fn(),
    updateTask: updateTaskMock,
    abandonTask: vi.fn(),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    pauseBlock: vi.fn(async () => undefined),
  }),
  getTaskTimerService: () => ({
    calculateSpentMinutes: vi.fn(async () => 0),
    startBlockForTask: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: () => ({
    getEvents: getEventsMock,
  }),
}));

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '任务 A',
    description: 'A desc',
    status: 'in_progress',
    priority: 'high',
    dependsOn: [],
    tags: [],
    estimatedMinutes: 60,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TaskDetailPage estimated minutes race issue #384', () => {
  beforeEach(() => {
    routeTaskId = 'task-1';
    navigateMock.mockReset();
    onTaskChangeMock.mockClear();

    const taskA = makeTask({ id: 'task-1', title: '任务 A', estimatedMinutes: 60, updatedAt: 10 });
    const taskB = makeTask({ id: 'task-2', title: '任务 B', estimatedMinutes: 30, updatedAt: 20 });

    getTaskMock.mockReset();
    getTaskMock.mockImplementation(async (id) => {
      if (id === 'task-1') return structuredClone(taskA);
      if (id === 'task-2') return structuredClone(taskB);
      return null;
    });

    listTasksMock.mockReset();
    listTasksMock.mockResolvedValue([structuredClone(taskA), structuredClone(taskB)]);

    updateTaskMock.mockReset();

    loadTimeBlocksMock.mockReset();
    loadTimeBlocksMock.mockResolvedValue([]);
    loadActiveBlockMock.mockReset();
    loadActiveBlockMock.mockResolvedValue(null);
    onBlockChangeMock.mockClear();

    getEventsMock.mockReset();
    getEventsMock.mockResolvedValue([]);

    mockMatchMedia(false);
  });

  it('does not let stale save response overwrite current task display（旧响应不污染当前任务估时显示）', async () => {
    const pendingSave = createDeferred<TaskNode | null>();
    updateTaskMock.mockImplementation(async (id, input) => {
      if (id === 'task-1' && input.estimatedMinutes === 45) {
        return pendingSave.promise;
      }
      return makeTask({ id, estimatedMinutes: input.estimatedMinutes, updatedAt: Date.now() });
    });

    const view = render(<TaskDetailPage />);

    await screen.findByText('关联任务：任务 A');
    expect(screen.getByTestId('estimated-time-preset-60')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('estimated-time-preset-45'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: 45 });
    });

    routeTaskId = 'task-2';
    view.rerender(<TaskDetailPage />);

    await screen.findByText('关联任务：任务 B');
    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveTextContent('30m');
    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      pendingSave.resolve(makeTask({ id: 'task-1', title: '任务 A', estimatedMinutes: 45, updatedAt: 999 }));
      await pendingSave.promise;
    });

    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveTextContent('30m');
    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows estimated editor when task is loaded directly even if listTasks is empty（任务直达加载时仍显示估时入口）', async () => {
    const directTask = makeTask({ id: 'task-1', title: '任务 A', estimatedMinutes: 25, updatedAt: 30 });

    getTaskMock.mockResolvedValueOnce(structuredClone(directTask));
    listTasksMock.mockResolvedValueOnce([]);

    render(<TaskDetailPage />);

    await screen.findByText('关联任务：任务 A');
    expect(screen.getByTestId('estimated-time-editor')).toBeInTheDocument();
    expect(screen.getByTestId('estimated-time-preset-25')).toHaveAttribute('aria-pressed', 'true');
  });
});
