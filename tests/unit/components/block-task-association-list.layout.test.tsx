import type { ReactNode } from 'react';
import { within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';

const loadActiveBlockMock = vi.fn();
const listTasksMock = vi.fn();

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: vi.fn(() => () => {}),
  }),
  getTaskService: () => ({
    listTasks: listTasksMock,
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    onTaskChange: vi.fn(() => () => {}),
  }),
  getTaskTimerService: () => ({
    addTaskToBlock: vi.fn(),
    removeTaskFromBlock: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: {
    children: ReactNode;
    to: string;
    params?: { taskId?: string };
    [key: string]: unknown;
  }) => {
    const href = to === '/tasks/$taskId' && params?.taskId ? `/tasks/${params.taskId}` : to;
    return <a href={href} {...props}>{children}</a>;
  },
}));

describe('BlockTaskAssociationList layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      { id: 'task-1', title: '已关联任务', status: 'in_progress' },
      { id: 'task-2', title: '可选任务', status: 'pending' },
    ]);
  });

  it('keeps the select shrinkable and the action button single-line with a minimum width（选择框可收缩且按钮单行保底宽度）', async () => {
    render(<BlockTaskAssociationList />);

    await screen.findByText('任务关联');

    const select = screen.getByRole('combobox');
    const button = screen.getByRole('button', { name: '关联任务' });
    const content = screen.getByTestId('task-association-content');
    const linkedList = screen.getByTestId('task-association-linked-list');
    const actions = screen.getByTestId('task-association-actions');
    const linkedTaskRow = screen.getByText('已关联任务').closest('div[class*="rounded-xl"]');
    const actionGroup = linkedTaskRow ? within(linkedTaskRow).getByRole('link', { name: '打开任务详情：已关联任务' }).parentElement : null;
    const detailButton = screen.getByRole('link', { name: '打开任务详情：已关联任务' });
    const removeButton = screen.getByRole('button', { name: '移除关联任务：已关联任务' });

    expect(content.className).toContain('space-y-3');
    expect(content).toContainElement(linkedList);
    expect(content).toContainElement(actions);
    expect(select.className).toContain('min-w-0');
    expect(select.className).toContain('flex-1');
    expect(select.className).toContain('h-[44px]');
    expect(button.className).toContain('shrink-0');
    expect(button.className).toContain('whitespace-nowrap');
    expect(button.className).toContain('min-w-[88px]');
    expect(button.className).toContain('h-[44px]');
    expect(linkedTaskRow?.className).toContain('min-h-[44px]');
    expect(detailButton.className).toContain('h-[32px]');
    expect(removeButton.className).toContain('w-[32px]');
    expect(actionGroup?.className).toContain('gap-2');
  });
});
