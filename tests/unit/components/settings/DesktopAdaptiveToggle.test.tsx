import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { setDesktopAdaptiveEnabled } from '@/config/desktop-adaptive';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

beforeEach(() => {
  vi.mocked(getDeveloperModeEnabled).mockReturnValue(true);
});

describe('SettingsPage - Desktop adaptive toggle（桌面适配开关）', () => {
  it('renders desktop adaptive switch in feature toggles drawer（在功能开关抽屉渲染桌面适配开关）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));
    expect(screen.getByText('桌面端适配')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-desktop-adaptive-switch')).toBeInTheDocument();
  });

  it('updates desktop adaptive config on toggle（切换时写入桌面适配配置）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText('功能开关'));
    fireEvent.click(screen.getByTestId('new-settings-desktop-adaptive-switch'));
    expect(vi.mocked(setDesktopAdaptiveEnabled)).toHaveBeenCalledWith(false);
  });
});
