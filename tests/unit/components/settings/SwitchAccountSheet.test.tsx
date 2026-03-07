import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SwitchAccountSheet } from '@/ui/app/components/SwitchAccountSheet';

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  listLocalProfiles: vi.fn(),
}));

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

import { listLocalProfiles } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';

const mockListLocalProfiles = vi.mocked(listLocalProfiles);
const mockUseSyncStore = vi.mocked(useSyncStore);

describe('SwitchAccountSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListLocalProfiles.mockReturnValue([
      {
        profileId: 'profile-1',
        slug: 'hailay',
        displayName: 'Hailay',
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
        authMode: 'password',
        state: 'active',
        defaultSyncPolicy: 'local-only',
      },
    ] as any);
  });

  it('shows logout entry when local profile is active（打开档案后显示退出入口）', () => {
    mockUseSyncStore.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      isLoggedIn: true,
      activeProfileId: 'profile-1',
    } as any);

    render(
      <SwitchAccountSheet
        open
        onOpenChange={vi.fn()}
        initialMode="switch"
      />
    );

    expect(screen.getByRole('button', { name: '退出当前档案' })).toBeInTheDocument();
  });

  it('logout entry triggers store logout and closes sheet（退出入口触发登出并关闭抽屉）', async () => {
    const onOpenChange = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockUseSyncStore.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout,
      isLoggedIn: true,
      activeProfileId: 'profile-1',
    } as any);

    render(
      <SwitchAccountSheet
        open
        onOpenChange={onOpenChange}
        initialMode="switch"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '退出当前档案' }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
