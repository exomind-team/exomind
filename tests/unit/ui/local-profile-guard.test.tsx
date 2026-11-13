import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusPage } from '@/ui/app/pages/FocusPage';

const { profileState, listProfiles } = vi.hoisted(() => ({
  profileState: { activeProfileId: null as string | null, isLoggedIn: false },
  listProfiles: vi.fn((): unknown[] => []),
}));
vi.mock('@/ui/stores/sync-store', () => ({ useSyncStore: () => profileState }));
vi.mock('@/lib/profile/profile-storage', () => ({ listLocalProfiles: listProfiles }));
vi.mock('@/ui/app/pages/NowPage', () => ({ NowPage: () => <div>可记录和计时</div> }));
vi.mock('@/ui/app/components/SwitchAccountSheet', () => ({
  SwitchAccountSheet: ({ open, initialMode }: { open: boolean; initialMode: string }) => open ? <div data-testid="profile-sheet">{initialMode}</div> : null,
}));

describe('当下页面的本地档案入口', () => {
  beforeEach(() => {
    profileState.activeProfileId = null;
    profileState.isLoggedIn = false;
    listProfiles.mockReturnValue([]);
  });

  it('首次启动直接提供本地创建入口，不呈现无法保存的发送或计时界面', () => {
    render(<FocusPage />);
    expect(screen.getByText('先打开本地档案')).toBeInTheDocument();
    expect(screen.queryByText('可记录和计时')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建本地档案' }));
    expect(screen.getByTestId('profile-sheet')).toHaveTextContent('register');
  });

  it('已有档案可直接选择并打开，打开后才挂载记录与计时', () => {
    listProfiles.mockReturnValue([{ profileId: 'profile-test' }]);
    const { rerender } = render(<FocusPage />);
    fireEvent.click(screen.getByRole('button', { name: '打开已有档案' }));
    expect(screen.getByTestId('profile-sheet')).toHaveTextContent('switch');
    profileState.activeProfileId = 'profile-test';
    profileState.isLoggedIn = true;
    rerender(<FocusPage />);
    expect(screen.getByText('可记录和计时')).toBeInTheDocument();
    profileState.isLoggedIn = false;
    rerender(<FocusPage />);
    expect(screen.queryByText('可记录和计时')).toBeNull();
  });
});
