import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';
import { setThemePreference } from '@/config/theme';
import { updateTimerPreferences } from '@/config/timer-preferences';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage timer card（新设置页计时器卡片）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPageServiceMocks.eventlogBackup.getBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    settingsPageServiceMocks.taskBackup.getBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('renders end-mode dialog from pencil（显示结束模式对话框）', async () => {
    render(<SettingsPage />);

    const trigger = screen.getByText('倒计时结束').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '倒计时结束模式' })).toBeInTheDocument();
    });
    const dialog = screen.getByRole('dialog', { name: '倒计时结束模式' });
    expect(dialog).toBeInTheDocument();
  });

  it('toggles theme segmented controls and persists preference（切换主题分段按钮并持久化）', () => {
    render(<SettingsPage />);

    const themeGroup = screen.getByRole('group', { name: '主题' });
    const systemButton = screen.getByTestId('new-settings-theme-system');
    const lightButton = screen.getByTestId('new-settings-theme-light');
    const darkButton = screen.getByTestId('new-settings-theme-dark');

    expect(systemButton).toHaveAttribute('aria-pressed', 'true');
    expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    expect(darkButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(lightButton);
    expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    expect(setThemePreference).toHaveBeenCalledWith('light');

    fireEvent.click(darkButton);
    expect(darkButton).toHaveAttribute('aria-pressed', 'true');
    expect(setThemePreference).toHaveBeenCalledWith('dark');
  });

  it('toggles end mode via dialog enum（通过对话框枚举切换结束模式）', async () => {
    render(<SettingsPage />);

    const trigger = screen.getByText('倒计时结束').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '倒计时结束模式' })).toBeInTheDocument();
    });

    const hardButton = screen.getByRole('button', { name: /硬停止/ });
    fireEvent.click(hardButton);

    expect(updateTimerPreferences).toHaveBeenCalledWith({ countdownEndMode: 'hard' });
  });

  it('renders data-transfer section in new row style（数据区使用新行式风格）', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('数据')).toBeInTheDocument();
    });
    expect(screen.getByText('导出数据')).toBeInTheDocument();
    expect(screen.getByText('导入数据')).toBeInTheDocument();
    expect(screen.queryByText('导出备份')).not.toBeInTheDocument();
  });

  it('removes legacy import strategy segmented controls（移除旧导入策略分段按钮）', () => {
    render(<SettingsPage />);

    expect(screen.queryByTestId('new-settings-import-strategy-merge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-import-strategy-overwrite')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-end-mode-hard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-end-mode-soft')).not.toBeInTheDocument();
  });
});
