import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskStatusSelector } from '@/ui/app/components/TaskStatusSelector';

describe('TaskStatusSelector issue-493（关联任务名过长）', () => {
  it('keeps long linked task title wrappable inside the dialog（较长任务名应允许换行）', () => {
    const linkedTaskTitle = '我们现在弄一个非常长的专注名称，这个时间块会是非常长的，所以我们需要测试换行是否能在反馈弹窗里正确生效，并且不要把弹窗撑破';

    render(
      <TaskStatusSelector
        value="continue"
        onChange={vi.fn()}
        linkedTaskTitle={linkedTaskTitle}
      />,
    );

    const linkedTitle = screen.getByTestId('feedback-task-linked-title');
    expect(linkedTitle).toHaveTextContent(linkedTaskTitle);
    expect(linkedTitle).toHaveClass('min-w-0');
    expect(linkedTitle).toHaveClass('flex-1');
    expect(linkedTitle).toHaveClass('whitespace-normal');
    expect(linkedTitle).toHaveClass('break-all');
    expect(linkedTitle).not.toHaveClass('truncate');
  });

  it('truncates linked task title after 100 characters with ellipsis（超过100字符后省略号截断）', () => {
    const linkedTaskTitle = `任务-${'超'.repeat(110)}-结尾`;
    const expectedTitle = `${Array.from(linkedTaskTitle).slice(0, 100).join('')}...`;

    render(
      <TaskStatusSelector
        value="continue"
        onChange={vi.fn()}
        linkedTaskTitle={linkedTaskTitle}
      />,
    );

    const linkedTitle = screen.getByTestId('feedback-task-linked-title');
    expect(linkedTitle).toHaveTextContent(expectedTitle);
    expect(linkedTitle).toHaveAttribute('title', linkedTaskTitle);
  });
});
