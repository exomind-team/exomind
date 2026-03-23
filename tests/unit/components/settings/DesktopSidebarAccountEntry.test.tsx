/**
 * DesktopSidebarAccountEntry 组件 - 单元测试
 *
 * 桌面侧栏左下角账户入口应接入当前 hybrid identity（混合身份）链路，
 * 而不是继续展示静态假用户信息。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesktopSidebarAccountEntry } from '@/ui/app/components/DesktopSidebarAccountEntry';

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  getLocalProfile: vi.fn(),
}));

vi.mock('@/lib/profile/identity-link-storage', () => ({
  getPreferredIdentityLink: vi.fn(),
}));

vi.mock('@/ui/app/components/SwitchAccountSheet', () => ({
  SwitchAccountSheet: ({ open, initialMode }: { open: boolean; initialMode: string }) => (
    open ? <div data-testid="desktop-sidebar-account-sheet">mode:{initialMode}</div> : null
  ),
}));

import { useSyncStore } from '@/ui/stores/sync-store';
import { getLocalProfile } from '@/lib/profile/profile-storage';
import { getPreferredIdentityLink } from '@/lib/profile/identity-link-storage';

const mockUseSyncStore = vi.mocked(useSyncStore);
const mockGetLocalProfile = vi.mocked(getLocalProfile);
const mockGetPreferredIdentityLink = vi.mocked(getPreferredIdentityLink);

describe('DesktopSidebarAccountEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows active local profile + linked remote identity（展示本地档案与远端身份）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue({
      linkId: 'link-1',
      profileId: 'profile-1',
      providerId: 'pouchdb',
      remoteIdentityId: 'remote-1',
      remoteIdentityKey: 'hailay@example.com',
      displayName: 'Hailay Cloud',
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: '2026-03-07T00:00:00.000Z',
    });

    render(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('Hailay')).toBeInTheDocument();
    expect(screen.getByText('Hailay Cloud')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-sidebar-account-entry')).toBeInTheDocument();
  });

  it('uses remote sync status copy when linked identity lacks display name（远端身份无显示名时展示状态文案）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue({
      linkId: 'link-1',
      profileId: 'profile-1',
      providerId: 'pouchdb',
      remoteIdentityId: 'remote-1',
      remoteIdentityKey: 'hailay@example.com',
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: '2026-03-07T00:00:00.000Z',
    });

    render(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('已连接远端同步身份')).toBeInTheDocument();
    expect(screen.queryByText('hailay@example.com')).not.toBeInTheDocument();
  });

  it('hides raw remote key when linked display name equals remote key（显示名等于远端标识时仍隐藏原始远端键）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue({
      linkId: 'link-1',
      profileId: 'profile-1',
      providerId: 'pouchdb',
      remoteIdentityId: 'remote-1',
      remoteIdentityKey: 'hailay@example.com',
      displayName: 'hailay@example.com',
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: '2026-03-07T00:00:00.000Z',
    });

    render(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('已连接远端同步身份')).toBeInTheDocument();
    expect(screen.queryByText('hailay@example.com')).not.toBeInTheDocument();
  });

  it('falls back to local-only subtitle（未绑定远端身份时回退到本地说明）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue(null);

    render(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('仅本地档案 · hailay')).toBeInTheDocument();
  });

  it('opens switch sheet in switch mode when logged in（已登录时打开切换档案）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue(null);

    render(<DesktopSidebarAccountEntry />);
    fireEvent.click(screen.getByTestId('desktop-sidebar-account-entry'));

    expect(screen.getByTestId('desktop-sidebar-account-sheet')).toHaveTextContent('mode:switch');
  });

  it('falls back to login mode when profile state is stale（本地档案缺失时回退到打开档案）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-missing',
    } as any);
    mockGetLocalProfile.mockReturnValue(null);
    mockGetPreferredIdentityLink.mockReturnValue(null);

    render(<DesktopSidebarAccountEntry />);
    fireEvent.click(screen.getByTestId('desktop-sidebar-account-entry'));

    expect(screen.getByTestId('desktop-sidebar-account-sheet')).toHaveTextContent('mode:login');
  });

  it('refreshes subtitle when remote identity link changes on same profile（同一档案绑定远端身份后刷新副标题）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: true,
      currentUser: 'legacy@example.com',
      activeProfileId: 'profile-1',
    } as any);
    mockGetLocalProfile.mockReturnValue({
      profileId: 'profile-1',
      slug: 'hailay',
      displayName: 'Hailay',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
      authMode: 'password',
      state: 'active',
      defaultSyncPolicy: 'local-only',
    });
    mockGetPreferredIdentityLink.mockReturnValue(null);

    const { rerender } = render(<DesktopSidebarAccountEntry />);
    expect(screen.getByText('仅本地档案 · hailay')).toBeInTheDocument();

    mockGetPreferredIdentityLink.mockReturnValue({
      linkId: 'link-1',
      profileId: 'profile-1',
      providerId: 'pouchdb',
      remoteIdentityId: 'remote-1',
      remoteIdentityKey: 'hailay@example.com',
      authMode: 'basic',
      status: 'linked',
      syncMode: 'realtime',
      linkedAt: '2026-03-07T00:00:00.000Z',
    });

    rerender(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('已连接远端同步身份')).toBeInTheDocument();
  });

  it('opens switch sheet in login mode when logged out（未登录时打开档案）', () => {
    mockUseSyncStore.mockReturnValue({
      isLoggedIn: false,
      currentUser: null,
      activeProfileId: null,
    } as any);
    mockGetLocalProfile.mockReturnValue(null);
    mockGetPreferredIdentityLink.mockReturnValue(null);

    render(<DesktopSidebarAccountEntry />);

    expect(screen.getByText('未打开档案')).toBeInTheDocument();
    expect(screen.getByText('点击打开或创建本地档案')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('desktop-sidebar-account-entry'));

    expect(screen.getByTestId('desktop-sidebar-account-sheet')).toHaveTextContent('mode:login');
  });
});
