import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MOCK_TASK_GOAL_GROUPS_FIXTURE } from '@/lib/adapters/mock/fixtures/tasks';
import { NewTaskTimerCard } from '@/ui/new/components/NewTaskTimerCard';
import { NewTasksPage } from '@/ui/new/pages/NewTasksPage';
import type { TaskItem } from '@/lib/types/task';

const listTasksMock = vi.fn();
const longTermGoalsMock = vi.fn();
const createTaskMock = vi.fn();

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    getLongTermGoals: longTermGoalsMock,
    createTask: createTaskMock,
    getTask: vi.fn(),
    setTimerMode: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    upsertTask: vi.fn(),
  }),
}));

const sampleTask: TaskItem = {
  id: 'task-1',
  title: '完成 Task List 视图设计',
  status: 'in_progress',
  progress: 45,
  createdAt: '2026-02-23T00:00:00.000Z',
  updatedAt: '2026-02-23T00:00:00.000Z',
  timer: {
    mode: 'countdown',
    paused: false,
    elapsedMs: 23 * 60 * 1000 + 45 * 1000,
    remainingMs: 23 * 60 * 1000 + 45 * 1000,
    targetMinutes: 45,
  },
};

describe('issue-213 task ui pages（任务页面还原）', () => {
  beforeEach(() => {
    listTasksMock.mockReset();
    longTermGoalsMock.mockReset();
    createTaskMock.mockReset();
    listTasksMock.mockResolvedValue([sampleTask]);
    longTermGoalsMock.mockResolvedValue(MOCK_TASK_GOAL_GROUPS_FIXTURE);
    createTaskMock.mockResolvedValue(sampleTask);
  });

  it('renders gradient glow + translucent card + 24 radius（卡片视觉令牌）', () => {
    render(<NewTaskTimerCard task={sampleTask} />);

    const card = screen.getByTestId('task-timer-main-card');
    const glow = screen.getByTestId('task-timer-glow');

    expect(card.className).toContain('rounded-[24px]');
    expect(card.className).toContain('bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)]');
    expect(glow.className).toContain('from-[#EDADA0]');
  });

  it('supports timer mode switch + pause button + input（计时模式/暂停/输入）', () => {
    render(<NewTaskTimerCard task={sampleTask} />);

    const countup = screen.getByTestId('task-mode-countup');
    const countdown = screen.getByTestId('task-mode-countdown');
    const pauseButton = screen.getByTestId('task-pause-button');
    const factInput = screen.getByPlaceholderText('记录当下的事实...');

    expect(countdown).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(countup);
    expect(countup).toHaveAttribute('aria-pressed', 'true');
    expect(pauseButton).toBeInTheDocument();
    expect(factInput).toBeInTheDocument();
  });

  it('renders task list page and quick-add input（任务列表页与快速输入）', async () => {
    render(<NewTasksPage />);
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByText('当下')).toBeInTheDocument();
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('快速添加任务...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('完成 Task List 视图设计')).toBeInTheDocument();
    });
  });

  it('renders long-term goals from pencil fixture（长期页渲染设计稿数据）', async () => {
    render(<NewTasksPage />);
    fireEvent.click(screen.getByRole('button', { name: '长期' }));

    await waitFor(() => {
      expect(screen.getByTestId('tasks-goals-content')).toBeInTheDocument();
      expect(screen.getByText('商业项目')).toBeInTheDocument();
      expect(screen.getByText('Exomind v0.3 发布')).toBeInTheDocument();
      expect(screen.getByText('科学研究')).toBeInTheDocument();
      expect(screen.getByText('人工认知生命理论')).toBeInTheDocument();
      expect(screen.getByText('知识学习')).toBeInTheDocument();
      expect(screen.getByText('眼睛健康')).toBeInTheDocument();
    });
  });

  it('applies dark-mode classes for long-term goals section（长期区域暗色模式样式）', async () => {
    render(<NewTasksPage />);
    fireEvent.click(screen.getByRole('button', { name: '长期' }));

    await waitFor(() => {
      const group = screen.getByTestId('tasks-goals-group-goal-group-business');
      const card = screen.getByTestId('tasks-goal-card-goal-biz-exomind-release');

      expect(group.className).toContain('dark:text-[#FAFAF9]');
      expect(card.className).toContain('dark:border-[#3A3432]');
      expect(card.className).toContain('dark:bg-[#1C1917]');
    });
  });
});

