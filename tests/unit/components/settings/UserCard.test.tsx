/**
 * UserCard 组件 - 单元测试
 * GH#217: User Card Action Row 当前不再展示“激活”按钮（activate button，激活按钮）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserCard } from '@/ui/app/components/UserCard';

// Mock dependencies
vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@/ui/app/components/SwitchAccountSheet', () => ({
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

    it('does not render activate button when logged in（登录态也不显示激活按钮）', () => {
      render(<UserCard />);
      expect(screen.queryByText('激活')).not.toBeInTheDocument();
    });

    it('renders switch account button', () => {
      render(<UserCard />);
      expect(screen.getByText('切换档案')).toBeInTheDocument();
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

    it('renders open-profile button（打开档案按钮）', () => {
      render(<UserCard />);
      expect(screen.getByText('打开档案')).toBeInTheDocument();
    });

    it('renders create-profile button（创建档案按钮）', () => {
      render(<UserCard />);
      expect(screen.getByText('创建档案')).toBeInTheDocument();
    });

    it('renders closed-profile state（未打开档案状态）', () => {
      render(<UserCard />);
      expect(screen.getByText('未打开档案')).toBeInTheDocument();
    });

    it('does not render activate button when logged out', () => {
      render(<UserCard />);
      expect(screen.queryByText('激活')).not.toBeInTheDocument();
    });
  });
});
