import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage, TASKS_QUICK_ADD_DRAFT_KEY } from '@/ui/app/pages/TasksPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('@/config/task-create-success-action', () => ({
  getTaskCreateSuccessAction: vi.fn(() => 'refocus'),
  setTaskCreateSuccessAction: vi.fn((value: string) => value),
  subscribeTaskCreateSuccessActionChanges: vi.fn(() => () => {}),
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: vi.fn(async ({ title, description, estimatedMinutes }: { title: string; description?: string; estimatedMinutes?: number }) => ({
      id: 'created-task',
      title,
      description,
      estimatedMinutes,
      status: 'pending',
      priority: 'medium',
      dependsOn: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
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
}));

describe('TasksPage issue-546 draft cache wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    listTasksMock.mockReset();
    listTasksMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores quick-add draft from the task-specific storage key', async () => {
    localStorage.setItem(TASKS_QUICK_ADD_DRAFT_KEY, '恢复未提交任务');

    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(screen.getByTestId('new-now-input-textarea')).toHaveValue('恢复未提交任务');
  });

  it('persists quick-add draft across remounts and clears it after submit', async () => {
    const { unmount } = render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    const textarea = screen.getByTestId('new-now-input-textarea');
    fireEvent.change(textarea, { target: { value: '跨页面保留的任务草稿' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(localStorage.getItem(TASKS_QUICK_ADD_DRAFT_KEY)).toBe('跨页面保留的任务草稿');

    unmount();
    render(<TasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-now-input-textarea')).toHaveValue('跨页面保留的任务草稿');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-now-send-button'));
    });

    expect(screen.getByTestId('new-now-input-textarea')).toHaveValue('');
    expect(localStorage.getItem(TASKS_QUICK_ADD_DRAFT_KEY)).toBeNull();
  });
});
