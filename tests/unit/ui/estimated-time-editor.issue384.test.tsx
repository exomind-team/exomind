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

  it('renders current estimatedMinutes and highlights current preset（显示当前估时并高亮预设）', () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={25} />);

    expect(screen.getByTestId('estimated-time-current')).toHaveTextContent('当前：25 分钟');
    expect(screen.getByTestId('estimated-time-preset-25')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a preset updates the estimatedMinutes（点击预设更新估时）', async () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={25} />);

    fireEvent.click(screen.getByTestId('estimated-time-preset-45'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: 45 });
    });

    expect(screen.getByTestId('estimated-time-current')).toHaveTextContent('当前：45 分钟');
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

    expect(screen.getByTestId('estimated-time-current')).toHaveTextContent('当前：90 分钟');
    expect(screen.getByTestId('estimated-time-custom-trigger')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clear resets the value to undefined（清空估时）', async () => {
    render(<EstimatedTimeEditor taskId="task-1" currentMinutes={60} />);

    fireEvent.click(screen.getByTestId('estimated-time-clear'));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { estimatedMinutes: undefined });
    });

    expect(screen.getByTestId('estimated-time-current')).toHaveTextContent('当前：未估时');
    expect(screen.getByTestId('estimated-time-clear')).toHaveAttribute('aria-pressed', 'true');
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
