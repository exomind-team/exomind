import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage } from '@/ui/app/pages/TasksPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const navigateMock = vi.fn();
const createTaskMock = vi.fn();
const taskCurrentRootCardMock = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="task-current-root-card"
    data-search-query={String(props.searchQuery ?? '')}
    data-collapsible={String(Boolean(props.collapsible))}
  />
));

const fuzzySearchState = vi.hoisted(() => {
  let enabled = true;
  let listeners: Array<(value: boolean) => void> = [];
  return {
    reset: () => {
      enabled = true;
      listeners = [];
    },
    getEnabled: () => enabled,
    subscribe: (listener: (value: boolean) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
    emit: (value: boolean) => {
      enabled = value;
      listeners.forEach((listener) => listener(value));
      return value;
    },
  };
});

const taskCreateSuccessActionState = vi.hoisted(() => {
  let value: 'refocus' | 'open-detail' = 'refocus';
  return {
    reset: () => {
      value = 'refocus';
    },
    get: () => value,
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: createTaskMock,
    getTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
    transitionTask: vi.fn(async () => null),
    getAvailableTransitions: vi.fn(async () => []),
    getChildTasks: vi.fn(async () => []),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    startSync: vi.fn(async () => {}),
    stopSync: vi.fn(async () => {}),
    onTaskChange: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/config/task-page-fuzzy-search', () => ({
  getTaskPageFuzzySearchEnabled: vi.fn(() => fuzzySearchState.getEnabled()),
  setTaskPageFuzzySearchEnabled: vi.fn((value: boolean) => fuzzySearchState.emit(value)),
  subscribeTaskPageFuzzySearchChanges: vi.fn((listener: (value: boolean) => void) => fuzzySearchState.subscribe(listener)),
}));

vi.mock('@/config/task-create-success-action', () => ({
  getTaskCreateSuccessAction: vi.fn(() => taskCreateSuccessActionState.get()),
  setTaskCreateSuccessAction: vi.fn((value: 'refocus' | 'open-detail') => value),
  subscribeTaskCreateSuccessActionChanges: vi.fn(() => () => {}),
}));

vi.mock('@/ui/app/components/PageMoreMenu', () => ({
  PageMoreMenu: () => <div data-testid="page-more-menu" />,
}));

vi.mock('@/ui/app/components/TaskCurrentRootCard', () => ({
  TaskCurrentRootCard: (props: Record<string, unknown>) => taskCurrentRootCardMock(props),
}));

vi.mock('@/ui/app/components/NowInputRow', async () => {
  const React = await import('react');
  return {
    NowInputRow: React.forwardRef(function MockNowInputRow(props: any, ref: any) {
      const [value, setValue] = React.useState('');
      React.useImperativeHandle(ref, () => ({
        focusText: vi.fn(),
        startVoiceRecording: vi.fn(),
      }));

      return (
        <div data-testid="task-search-input-row">
          <textarea
            data-testid="task-search-input"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              props.onValueChange?.(event.target.value);
            }}
          />
          <button
            type="button"
            data-testid="task-search-send"
            onClick={() => {
              void props.onSend(value);
              setValue('');
              props.onValueChange?.('');
            }}
          >
            send
          </button>
        </div>
      );
    }),
  };
});

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string; updatedAt: number }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: overrides.updatedAt,
    updatedAt: overrides.updatedAt,
    ...overrides,
  };
}

function visibleTaskOrder(): string[] {
  return screen
    .queryAllByTestId(/tasks-page-task-link-/)
    .map((node) => node.getAttribute('data-testid') ?? '');
}

async function flushLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('TasksPage issue-546 fuzzy search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fuzzySearchState.reset();
    taskCreateSuccessActionState.reset();
    listTasksMock.mockReset();
    createTaskMock.mockReset();
    navigateMock.mockReset();
    taskCurrentRootCardMock.mockClear();
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: 'aba', updatedAt: 10 }),
      makeTask({ id: 'task-2', title: 'baaab', updatedAt: 20 }),
      makeTask({ id: 'task-3', title: 'delta', updatedAt: 30 }),
      makeTask({ id: 'task-4', title: 'abacus', updatedAt: 40 }),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces search, matches only the first line, and sorts by fuzzy score', async () => {
    render(<TasksPage />);

    await flushLoad();
    expect(listTasksMock).toHaveBeenCalledWith(true);

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-4',
      'tasks-page-task-link-task-3',
      'tasks-page-task-link-task-2',
      'tasks-page-task-link-task-1',
    ]);
    expect(screen.getByTestId('task-current-root-card')).toHaveAttribute('data-search-query', '');
    expect(screen.getByTestId('task-current-root-card')).toHaveAttribute('data-collapsible', 'true');

    fireEvent.change(screen.getByTestId('task-search-input'), {
      target: { value: 'ab\nzzz' },
    });

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-4',
      'tasks-page-task-link-task-3',
      'tasks-page-task-link-task-2',
      'tasks-page-task-link-task-1',
    ]);

    await act(async () => {
      vi.advanceTimersByTime(179);
    });

    expect(visibleTaskOrder()).toHaveLength(4);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-2',
      'tasks-page-task-link-task-1',
      'tasks-page-task-link-task-4',
    ]);
    expect(screen.queryByTestId('tasks-page-task-link-task-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card')).toHaveAttribute('data-search-query', 'ab');
  });

  it('restores the full list immediately when fuzzy search is turned off', async () => {
    render(<TasksPage />);

    await flushLoad();
    expect(listTasksMock).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByTestId('task-search-input'), {
      target: { value: 'ab' },
    });

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-2',
      'tasks-page-task-link-task-1',
      'tasks-page-task-link-task-4',
    ]);

    await act(async () => {
      fuzzySearchState.emit(false);
    });

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-4',
      'tasks-page-task-link-task-3',
      'tasks-page-task-link-task-2',
      'tasks-page-task-link-task-1',
    ]);
    expect(screen.getByTestId('task-current-root-card')).toHaveAttribute('data-search-query', '');
  });

  it('includes terminal tasks in results while an active title search is running', async () => {
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: 'Active alpha', updatedAt: 10, status: 'pending' }),
      makeTask({ id: 'task-2', title: 'Archived alpha', updatedAt: 20, status: 'completed' }),
      makeTask({ id: 'task-3', title: 'Cancelled alpha', updatedAt: 30, status: 'cancelled' }),
      makeTask({ id: 'task-4', title: 'delta', updatedAt: 40, status: 'pending' }),
    ]);

    render(<TasksPage />);

    await flushLoad();

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-4',
      'tasks-page-task-link-task-1',
    ]);

    fireEvent.change(screen.getByTestId('task-search-input'), {
      target: { value: 'alpha' },
    });

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.getByTestId('tasks-page-task-link-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-page-task-link-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-page-task-link-task-3')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-page-task-link-task-4')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('task-search-input'), {
      target: { value: '' },
    });

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(visibleTaskOrder()).toEqual([
      'tasks-page-task-link-task-4',
      'tasks-page-task-link-task-1',
    ]);
  });
});
