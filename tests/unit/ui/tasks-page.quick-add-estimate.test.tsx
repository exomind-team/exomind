import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksPage } from '@/ui/app/pages/TasksPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const createTaskMock = vi.fn<
  (input: { title: string; description?: string; estimatedMinutes?: number }) => Promise<TaskNode>
>();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    createTask: createTaskMock,
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

describe('TasksPage quick add estimate default', () => {
  beforeEach(() => {
    listTasksMock.mockReset();
    createTaskMock.mockReset();

    listTasksMock.mockResolvedValue([]);
    createTaskMock.mockImplementation(async (input) => ({
      id: 'created-task',
      title: input.title,
      description: input.description,
      estimatedMinutes: input.estimatedMinutes,
      status: 'pending',
      priority: 'medium',
      dependsOn: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });

  it('quick add does not force a default 25min estimate', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    fireEvent.change(screen.getByTestId('new-now-input-textarea'), {
      target: { value: '新任务\n补充描述' },
    });
    fireEvent.click(screen.getByTestId('new-now-send-button'));

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledTimes(1);
    });

    const createInput = createTaskMock.mock.calls[0][0];
    expect(createInput).toMatchObject({
      title: '新任务',
      description: '补充描述',
    });
    expect(createInput.estimatedMinutes).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(createInput, 'estimatedMinutes')).toBe(false);
    expect(await screen.findByText('未估时')).toBeInTheDocument();
  });
});
