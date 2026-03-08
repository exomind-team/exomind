import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskNode } from '@/lib/types/task';
import { EstimatedTimeEditor } from '@/ui/app/components/EstimatedTimeEditor';

const updateTaskMock = vi.fn<(taskId: string, input: { estimatedMinutes?: number }) => Promise<TaskNode | null>>();

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    updateTask: updateTaskMock,
  }),
}));

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '补 EstimatedTimeEditor',
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: ['issue-384'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('EstimatedTimeEditor issue #384', () => {
  beforeEach(() => {
    updateTaskMock.mockReset();
    updateTaskMock.mockResolvedValue(makeTask());
  });

  it('renders selected preset without current text（高亮预设且不显示当前文案）', () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={25} />);

    expect(screen.queryByTestId('estimated-time-current')).not.toBeInTheDocument();
    expect(screen.getByTestId('estimated-time-none')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('estimated-time-preset-25')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a preset updates the estimatedMinutes（点击预设更新估时）', async () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={25} />);

    fireEvent.click(screen.getByTestId('estimated-time-preset-45'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: 45 });
    });

    expect(screen.getByTestId('estimated-time-none')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('estimated-time-preset-45')).toHaveAttribute('aria-pressed', 'true');
  });

  it('custom input updates the estimatedMinutes（自定义输入更新估时）', async () => {
    render(<EstimatedTimeEditor taskId="task-1" />);

    fireEvent.click(screen.getByTestId('estimated-time-custom-trigger'));
    fireEvent.change(screen.getByTestId('estimated-time-custom-input'), { target: { value: '90' } });
    fireEvent.keyDown(screen.getByTestId('estimated-time-custom-input'), { key: 'Enter' });

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: 90 });
    });

    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveTextContent('90m');
    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveAttribute('aria-pressed', 'true');
  });

  it('none option resets the value to undefined（无选项重置估时）', async () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={60} />);

    fireEvent.click(screen.getByTestId('estimated-time-none'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: undefined });
    });

    expect(screen.getByTestId('estimated-time-none')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onUpdate after successful save（保存成功后回调 onUpdate）', async () => {
    const onUpdate = vi.fn();
    render(<EstimatedTimeEditor taskId="task-1" onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTestId('estimated-time-preset-15'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: 15 });
    });

    expect(onUpdate).toHaveBeenCalledWith(15);
  });
});
