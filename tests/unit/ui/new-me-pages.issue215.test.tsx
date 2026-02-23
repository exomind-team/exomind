import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewMePage } from '@/ui/new/pages/NewMePage';
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
    render(<NewMePage />);

    expect(await screen.findByRole('heading', { name: 'Me' })).toBeInTheDocument();
    const statusTab = screen.getByRole('button', { name: '状态' });
    expect(statusTab).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('me-status-summary-card')).toBeInTheDocument();
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });
  });

  it('uses task-like pill tab style（顶部标签与任务页胶囊风格统一）', async () => {
    render(<NewMePage />);

    await waitFor(() => {
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });

    const statusTab = screen.getByRole('button', { name: '状态' });
    const learnTab = screen.getByRole('button', { name: '学习' });

    expect(statusTab.className).toContain('rounded-2xl');
    expect(statusTab.className).toContain('bg-[#C75B3A]');
    expect(statusTab.className).toContain('text-white');
    expect(learnTab.className).toContain('rounded-2xl');
    expect(learnTab.className).toContain('bg-[#F5F0ED]');
  });

  it('switches to learn and implicit tabs（可切换到学习与内隐）', async () => {
    render(<NewMePage />);

    await waitFor(() => {
      expect(screen.getByText('当前状态')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '学习' }));
    expect(screen.getByRole('button', { name: '学习' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(screen.getByTestId('me-learn-urgent-card')).toBeInTheDocument();
      expect(screen.getByText('急需知识')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '内隐' }));
    expect(screen.getByRole('button', { name: '内隐' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(screen.getByTestId('me-implicit-belief-card')).toBeInTheDocument();
      expect(screen.getByText('信念网络')).toBeInTheDocument();
    });
  });

  it('applies dark-readable classes for key child cards（关键子卡片具备暗色可读样式）', async () => {
    render(<NewMePage />);

    await waitFor(() => {
      expect(screen.getByText('读 3 页商业书')).toBeInTheDocument();
    });

    const behaviorTitle = screen.getByText('读 3 页商业书');
    const behaviorCard = behaviorTitle.closest('article');
    expect(behaviorCard?.className).toContain('dark:bg');
    expect(behaviorTitle.className).toContain('dark:text');

    fireEvent.click(screen.getByRole('button', { name: '学习' }));
    await waitFor(() => {
      expect(screen.getByText('编译器')).toBeInTheDocument();
    });

    const laneTitle = screen.getByText('编译器');
    const laneCard = laneTitle.closest('article');
    expect(laneCard?.className).toContain('dark:bg');
    expect(laneTitle.className).toContain('dark:text');
  });
});
