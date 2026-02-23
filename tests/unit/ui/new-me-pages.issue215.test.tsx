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
});
