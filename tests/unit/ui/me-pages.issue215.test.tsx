import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MePage } from '@/ui/app/pages/MePage';
import { MOCK_ME_DASHBOARD_FIXTURE } from '@/lib/adapters/mock/fixtures/me';

const getDashboardDataMock = vi.fn();

vi.mock('@/lib/services', () => ({
  getMeService: () => ({
    getDashboardData: getDashboardDataMock,
  }),
}));

describe('issue-215 me ui page（Me 三视图页面）', () => {
  beforeEach(() => {
    getDashboardDataMock.mockReset();
    getDashboardDataMock.mockResolvedValue(MOCK_ME_DASHBOARD_FIXTURE);
  });

  it('renders status view by default（默认展示状态视图）', async () => {
    render(<MePage />);

    expect(await screen.findByRole('heading', { name: 'Me' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const statusTab = screen.getByRole('tab', { name: '状态' });
    expect(statusTab).toHaveAttribute('aria-selected', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('me-status-summary-card')).toBeInTheDocument();
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });
  });

  it('uses task-like pill tab style（顶部标签与任务页胶囊风格统一）', async () => {
    render(<MePage />);

    await waitFor(() => {
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });

    const statusTab = screen.getByRole('tab', { name: '状态' });
    const learnTab = screen.getByRole('tab', { name: '学习' });

    expect(statusTab.className).toContain('rounded-lg');
    expect(statusTab.className).toContain('data-[state=active]');
    expect(learnTab.className).toContain('rounded-lg');
    expect(learnTab.className).toContain('text-secondary');
  });

  it('switches to learn and implicit tabs（可切换到学习与内隐）', async () => {
    const user = userEvent.setup();
    render(<MePage />);

    await waitFor(() => {
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: '学习' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '学习' })).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      expect(screen.getByTestId('me-learn-urgent-card')).toBeInTheDocument();
      expect(screen.getByText('急需知识')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: '内隐' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '内隐' })).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      expect(screen.getByTestId('me-implicit-belief-card')).toBeInTheDocument();
      expect(screen.getByText('信念网络')).toBeInTheDocument();
    });
  });

  it('applies dark-readable classes for key child cards（关键子卡片具备暗色可读样式）', async () => {
    const user = userEvent.setup();
    render(<MePage />);

    await waitFor(() => {
      expect(screen.getByText('读 3 页商业书')).toBeInTheDocument();
    });

    const behaviorTitle = screen.getByText('读 3 页商业书');
    const behaviorCard = behaviorTitle.closest('article');
    expect(behaviorCard?.className).toContain('dark:bg');
    expect(behaviorTitle.className).toContain('dark:text');

    await user.click(screen.getByRole('tab', { name: '学习' }));
    await waitFor(() => {
      expect(screen.getByText('编译器')).toBeInTheDocument();
    });

    const laneTitle = screen.getByText('编译器');
    const laneCard = laneTitle.closest('article');
    expect(laneCard?.className).toContain('dark:bg');
    expect(laneTitle.className).toContain('dark:text');
  });
});
