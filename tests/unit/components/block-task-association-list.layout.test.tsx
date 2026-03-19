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

    expect(select.className).toContain('min-w-0');
    expect(select.className).toContain('flex-1');
    expect(button.className).toContain('shrink-0');
    expect(button.className).toContain('whitespace-nowrap');
    expect(button.className).toContain('min-w-[88px]');
  });
});
