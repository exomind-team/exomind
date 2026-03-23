import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskStatusSelector } from '@/ui/app/components/TaskStatusSelector';

describe('TaskStatusSelector issue-493', () => {
  it('shows helper guidance instead of repeating the task title', () => {
    render(
      <TaskStatusSelector
        value="continue"
        onChange={vi.fn()}
      />,
    );

    const section = screen.getByTestId('feedback-task-status-section');
    expect(section).toBeInTheDocument();
    expect(screen.getByText('关联任务下一步状态')).toBeInTheDocument();
    expect(screen.getByText('请选择')).toBeInTheDocument();
    expect(screen.queryByTestId('feedback-task-linked-title')).toBeNull();
  });

  it('supports custom option test id prefixes and preserves status switching', () => {
    const onChange = vi.fn();

    render(
      <TaskStatusSelector
        value="continue"
        onChange={onChange}
        optionTestIdPrefix="feedback-task-status-task-1"
      />,
    );

    fireEvent.click(screen.getByTestId('feedback-task-status-task-1-completed'));

    expect(onChange).toHaveBeenCalledWith('completed');
    expect(screen.getByTestId('feedback-task-status-task-1-suspended')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-task-status-task-1-continue')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-task-status-task-1-cancelled')).toBeInTheDocument();
  });
});
