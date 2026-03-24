import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SwitchAccountSheet } from '@/ui/app/components/SwitchAccountSheet';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div data-testid="mock-dialog-root">{children}</div> : null),
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => <div data-testid="mock-dialog-content" className={className}>{children}</div>,
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div data-testid="mock-drawer-root">{children}</div> : null),
  DrawerContent: ({ children, className }: { children: ReactNode; className?: string }) => <div data-testid="mock-drawer-content" className={className}>{children}</div>,
  DrawerTitle: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  listLocalProfiles: vi.fn(),
}));

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

import { listLocalProfiles } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

const mockListLocalProfiles = vi.mocked(listLocalProfiles);
const mockUseSyncStore = vi.mocked(useSyncStore);
const mockUseIsDesktop = vi.mocked(useIsDesktop);

describe('SwitchAccountSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsDesktop.mockReturnValue(false);
    mockListLocalProfiles.mockReturnValue([
      {
        profileId: 'profile-1',
        slug: 'exomind',
        displayName: 'Hailay',
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
        authMode: 'password',
        state: 'active',
        defaultSyncPolicy: 'local-only',
      },
    ] as any);
  });

  it('uses Drawer on mobile and Dialog on desktop（移动端 Drawer，桌面端 Dialog）', () => {
    mockUseSyncStore.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      isLoggedIn: true,
      activeProfileId: 'profile-1',
    } as any);

    const { rerender } = render(
      <SwitchAccountSheet
        open
        onOpenChange={vi.fn()}
        initialMode="switch"
      />
    );

    expect(screen.getByTestId('mock-drawer-root')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-dialog-root')).toBeNull();

    mockUseIsDesktop.mockReturnValue(true);
    rerender(
      <SwitchAccountSheet
        open
        onOpenChange={vi.fn()}
        initialMode="switch"
      />
    );

    expect(screen.getByTestId('mock-dialog-root')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-drawer-root')).toBeNull();
  });

  it('adds dark mode classes to desktop and mobile container（容器带深色模式类）', () => {
    mockUseSyncStore.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      isLoggedIn: true,
      activeProfileId: 'profile-1',
    } as any);

    const { rerender } = render(
      <SwitchAccountSheet
        open
        onOpenChange={vi.fn()}
        initialMode="switch"
      />
    );

    expect(screen.getByTestId('mock-drawer-content').className).toContain('dark:bg-[#1C1917]');

    mockUseIsDesktop.mockReturnValue(true);
    rerender(
      <SwitchAccountSheet
        open
        onOpenChange={vi.fn()}
        initialMode="switch"
      />
    );

    expect(screen.getByTestId('mock-dialog-content').className).toContain('dark:bg-[#1C1917]');
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
