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
  it('renders desktop adaptive switch directly in developer section（在开发者区域直接渲染桌面适配开关）', () => {
    render(<SettingsPage />);
    expect(screen.getByText('桌面端适配')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-desktop-adaptive-switch')).toBeInTheDocument();
    expect(screen.getByTestId('feature-toggle-desktop-adaptive-row').querySelector('svg')).not.toBeNull();
  });

  it('does not open a second dialog or drawer for desktop adaptive toggle', () => {
    mockMatchMedia({ isDesktop: true, isLandscape: true });

    render(<SettingsPage />);
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(screen.queryByTestId('drawer')).toBeNull();
  });

  it('updates desktop adaptive config on toggle（切换时写入桌面适配配置）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByTestId('new-settings-desktop-adaptive-switch'));
    expect(vi.mocked(setDesktopAdaptiveEnabled)).toHaveBeenCalledWith(false);
  });

  it('uses developer section toneColor on the direct desktop adaptive switch（直接开关继承开发者主题色）', () => {
    render(<SettingsPage />);
    const toggle = screen.getByTestId('new-settings-desktop-adaptive-switch');

    expect(toggle.getAttribute('style') ?? '').toContain(
      '--switch-checked-bg: var(--settings-tone-color, var(--settings-tone-default))',
    );
  });
});
