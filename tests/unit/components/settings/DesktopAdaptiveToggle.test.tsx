import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { setDesktopAdaptiveEnabled } from '@/config/desktop-adaptive';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

function mockMatchMedia({
  isDesktop = false,
  isLandscape = false,
}: {
  isDesktop?: boolean;
  isLandscape?: boolean;
}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width') ? isDesktop : query.includes('orientation: landscape') ? isLandscape : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  vi.mocked(getDeveloperModeEnabled).mockReturnValue(true);
  mockMatchMedia({ isDesktop: false, isLandscape: false });
});

describe('SettingsPage - Desktop adaptive toggle（桌面适配开关）', () => {
  it('renders desktop adaptive switch in feature toggles drawer（在功能开关抽屉渲染桌面适配开关）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));
    expect(screen.getByText('桌面端适配')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-desktop-adaptive-switch')).toBeInTheDocument();
    expect(screen.getByTestId('feature-toggle-desktop-adaptive-row').querySelector('svg')).not.toBeNull();
  });

  it('uses dialog in landscape mode and drawer in portrait mode for feature toggles group', () => {
    mockMatchMedia({ isDesktop: true, isLandscape: true });

    const { unmount } = render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));

    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('drawer')).toBeNull();

    unmount();

    mockMatchMedia({ isDesktop: false, isLandscape: false });

    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));

    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('updates desktop adaptive config on toggle（切换时写入桌面适配配置）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));
    fireEvent.click(screen.getByTestId('new-settings-desktop-adaptive-switch'));
    expect(vi.mocked(setDesktopAdaptiveEnabled)).toHaveBeenCalledWith(false);
  });

  it('uses developer section toneColor inside the feature toggles drawer（功能开关抽屉继承开发者主题色）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));

    const drawerContent = screen.getByTestId('feature-toggles-drawer-content');
    const toggle = screen.getByTestId('new-settings-desktop-adaptive-switch');

    expect(drawerContent.getAttribute('style') ?? '').toContain('--settings-tone-color: var(--settings-tone-developer)');
    expect(toggle.getAttribute('style') ?? '').toContain(
      '--switch-checked-bg: var(--settings-tone-color, var(--settings-tone-default))',
    );
  });
});
