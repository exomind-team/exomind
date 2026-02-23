/**
 * UserCard 组件 - 单元测试
 * GH#217: User Card Action Row 新增「激活」按钮
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserCard } from '@/ui/new/components/UserCard';

// Mock dependencies
vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@/ui/new/components/SwitchAccountSheet', () => ({
  SwitchAccountSheet: () => <div data-testid="switch-account-sheet" />,
}));

import { useSyncStore } from '@/ui/stores/sync-store';
const mockUseSyncStore = vi.mocked(useSyncStore);

describe('UserCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logged in state', () => {
    beforeEach(() => {
      mockUseSyncStore.mockReturnValue({
        isLoggedIn: true,
        currentUser: 'TestUser',
        logout: vi.fn(),
      } as any);
    });

    it('renders activate button', () => {
      render(<UserCard />);
      expect(screen.getByText('激活')).toBeInTheDocument();
    });

    it('renders switch account button', () => {
      render(<UserCard />);
      expect(screen.getByText('切换账户')).toBeInTheDocument();
    });

    it('renders logout button', () => {
      render(<UserCard />);
      expect(screen.getByText('登出')).toBeInTheDocument();
    });

    it('renders user name', () => {
      render(<UserCard />);
      expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('renders avatar with first letter', () => {
      render(<UserCard />);
      expect(screen.getByText('T')).toBeInTheDocument();
    });
  });

  describe('logged out state', () => {
    beforeEach(() => {
      mockUseSyncStore.mockReturnValue({
        isLoggedIn: false,
        currentUser: null,
        logout: vi.fn(),
      } as any);
    });

    it('renders login button', () => {
      render(<UserCard />);
      expect(screen.getByText('登录')).toBeInTheDocument();
    });

    it('renders register button', () => {
      render(<UserCard />);
      expect(screen.getByText('注册')).toBeInTheDocument();
    });

    it('does not render activate button when logged out', () => {
      render(<UserCard />);
      expect(screen.queryByText('激活')).not.toBeInTheDocument();
    });
  });
});
