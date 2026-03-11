import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import type { SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

const getVisibleSettingsMock = vi.fn<(ctx: SettingsContext) => SettingsItem[]>();
const desktopLayoutProps = vi.fn();
const mobileLayoutProps = vi.fn();

vi.mock('@/ui/app/config/settings/settings-registry', () => ({
  getVisibleSettings: (ctx: SettingsContext) => getVisibleSettingsMock(ctx),
}));

vi.mock('@/ui/app/layouts/DesktopSettingsLayout', () => ({
  DesktopSettingsLayout: (props: { items: SettingsItem[]; ctx: SettingsContext }) => {
    desktopLayoutProps(props);
    return <div data-testid="desktop-layout-mock" />;
  },
}));

vi.mock('@/ui/app/layouts/MobileSettingsLayout', () => ({
  MobileSettingsLayout: (props: { items: SettingsItem[]; ctx: SettingsContext }) => {
    mobileLayoutProps(props);
    return <div data-testid="mobile-layout-mock" />;
  },
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage layout dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVisibleSettingsMock.mockReturnValue([]);
  });

  it('uses desktop registry layout when desktop media query matches', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 768px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<SettingsPage />);

    expect(getVisibleSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ isDesktop: true }));
    expect(screen.getByTestId('desktop-layout-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-layout-mock')).not.toBeInTheDocument();
    expect(desktopLayoutProps).toHaveBeenCalledWith(expect.objectContaining({
      items: [],
      ctx: expect.objectContaining({ isDesktop: true }),
    }));
  });

  it('uses mobile registry layout when desktop media query does not match', () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<SettingsPage />);

    expect(getVisibleSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ isDesktop: false }));
    expect(screen.getByTestId('mobile-layout-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-layout-mock')).not.toBeInTheDocument();
    expect(mobileLayoutProps).toHaveBeenCalledWith(expect.objectContaining({
      items: [],
      ctx: expect.objectContaining({ isDesktop: false }),
    }));
  });
});
