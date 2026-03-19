import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSendMode } from '@/config/input-send-mode';
import { MultiTaskEndDialog } from '@/ui/app/components/MultiTaskEndDialog';
import type { TaskNode } from '@/lib/types/task';

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'in_progress',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('MultiTaskEndDialog overflow regression', () => {
  beforeEach(() => {
    setInputSendMode('ctrl-enter-send');
    vi.useRealTimers();
  });

  it('keeps long task titles readable and shows localized status guidance inside the dialog', () => {
    const longTitle = '#560 feat(task-dag): 选中节点后展示详情栏/抽屉，移除常驻节点详情卡片，并确保结束时间块弹窗中的关联任务文本可以在模态框内正常换行而不是把内容撑出可视区域';

    render(
      <MultiTaskEndDialog
        open
        tasks={[makeTask({ id: 'task-1', title: longTitle })]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    const dialog = screen.getByTestId('task-dag-end-dialog');
    expect(dialog).toHaveClass('w-[calc(100vw-2rem)]');
    expect(dialog).toHaveClass('max-w-lg');
    expect(dialog).toHaveClass('overflow-y-auto');

    const taskList = screen.getByTestId('task-dag-end-dialog-task-list');
    expect(taskList).toHaveClass('min-w-0');

    const taskCard = screen.getByTestId('task-dag-end-dialog-task-task-1');
    expect(taskCard).toHaveClass('min-w-0');

    const title = within(taskCard).getByText(longTitle);
    expect(title).toHaveClass('min-w-0');
    expect(title).toHaveClass('flex-1');
    expect(title).toHaveClass('whitespace-normal');
    expect(title).toHaveClass('break-all');
    expect(title).toHaveClass('[overflow-wrap:anywhere]');
    expect(title).not.toHaveClass('truncate');

    expect(within(taskCard).getByText('进行中')).toBeInTheDocument();

    const statusSection = within(taskCard).getByTestId('feedback-task-status-section');
    expect(statusSection).toHaveClass('min-w-0');
    expect(within(statusSection).getByText('关联任务下一步状态')).toBeInTheDocument();
    expect(within(statusSection).getByText('请选择')).toBeInTheDocument();
  });

  it('requires a 5s cooldown before submitting empty feedback', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <MultiTaskEndDialog
        open
        tasks={[makeTask({ id: 'task-1', title: '空反馈测试' })]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const submitButton = screen.getByTestId('task-dag-end-dialog-submit');

    vi.useFakeTimers();
    fireEvent.click(submitButton);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('确认跳过反馈(5s)');

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(submitButton).not.toBeDisabled();
    expect(submitButton).toHaveTextContent('确认跳过反馈');

    vi.useRealTimers();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        feedback: '',
        outcomes: { 'task-1': 'continue' },
      });
    });
  });

  it('submits on Ctrl+Enter by default and follows enter-send setting', async () => {
    const onSubmit = vi.fn(async () => undefined);

    const { rerender } = render(
      <MultiTaskEndDialog
        open
        tasks={[makeTask({ id: 'task-1', title: '快捷键测试' })]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByTestId('task-dag-end-dialog-feedback');
    fireEvent.change(textarea, { target: { value: '默认 Ctrl+Enter 提交' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    setInputSendMode('enter-send');
    onSubmit.mockClear();

    rerender(
      <MultiTaskEndDialog
        open
        tasks={[makeTask({ id: 'task-1', title: '快捷键测试' })]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const textareaWithEnterSend = screen.getByTestId('task-dag-end-dialog-feedback');
    fireEvent.change(textareaWithEnterSend, { target: { value: 'Enter 模式提交' } });
    fireEvent.keyDown(textareaWithEnterSend, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textareaWithEnterSend).toHaveValue('Enter 模式提交\n');

    fireEvent.keyDown(textareaWithEnterSend, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
