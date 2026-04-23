import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import {
  setSyncAutomationEnabled,
} from '@/config/sync-automation-enabled';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { settingsPagePreferenceState } from './setup-settings-mocks.tsx';

describe('SettingsPage - Sync automation setting（自动配对与自动同步设置项）', () => {
  beforeEach(() => {
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPagePreferenceState.isDesktopOperatingSystem = true;
    settingsPagePreferenceState.syncAutomationEnabled = true;
  });

  it('renders the connection setting in settings page（设置页展示自动配对与自动同步开关）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('自动配对与自动同步')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-sync-automation-switch')).toBeInTheDocument();
  });

  it('updates RT-local sync automation state on toggle（切换时写入 RT 本地自动化配置）', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-sync-automation-switch'));

    expect(vi.mocked(setSyncAutomationEnabled)).toHaveBeenCalledWith(false);
  });
});
