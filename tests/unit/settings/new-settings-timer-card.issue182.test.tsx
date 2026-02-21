import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: vi.fn(),
    importEventsFromJson: vi.fn(),
  }),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: () => null,
  resolveSyncServerUrl: () => 'http://127.0.0.1:6984',
  setSyncServerUrlOverride: vi.fn(),
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: () => 'system',
  setThemePreference: vi.fn(),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => false,
  setDeveloperModeEnabled: vi.fn(),
}));

vi.mock('@/ui/pages/UserManagePage', () => ({
  UserManagePage: () => <div data-testid="user-manage-page-mock">UserManagePage</div>,
}));

import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

describe('NewSettingsPage timer card（新设置页计时器卡片）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
    window.localStorage.clear();
  });

  it('renders end-mode segmented controls from pencil（显示结束模式分段切换）', () => {
    render(<NewSettingsPage />);

    expect(screen.getByText('结束模式')).toBeInTheDocument();
    expect(screen.getByText('倒计时结束后的行为')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '硬结束' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '软结束' })).toBeInTheDocument();
  });

  it('toggles end mode and persists selection（切换结束模式并持久化）', () => {
    render(<NewSettingsPage />);

    const hardButton = screen.getByTestId('new-settings-end-mode-hard');
    const softButton = screen.getByTestId('new-settings-end-mode-soft');

    fireEvent.click(hardButton);
    expect(hardButton).toHaveAttribute('aria-pressed', 'true');
    expect(softButton).toHaveAttribute('aria-pressed', 'false');

    const hardRaw = window.localStorage.getItem('exomind:timerPreferences');
    expect(hardRaw).not.toBeNull();
    expect(JSON.parse(hardRaw || '{}').countdownEndMode).toBe('hard');

    fireEvent.click(softButton);
    expect(softButton).toHaveAttribute('aria-pressed', 'true');

    const softRaw = window.localStorage.getItem('exomind:timerPreferences');
    expect(softRaw).not.toBeNull();
    expect(JSON.parse(softRaw || '{}').countdownEndMode).toBe('soft');
  });

  it('opens sound picker and updates selected preset（提示音可打开选择并更新）', () => {
    render(<NewSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '提示音' }));

    expect(screen.getByRole('dialog', { name: '选择提示音' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ring 10' }));

    expect(screen.getByText('Ring 10')).toBeInTheDocument();
  });

  it('renders import-export section in new row style（导入导出区使用新行式风格）', () => {
    render(<NewSettingsPage />);

    expect(screen.getByTestId('new-settings-import-export-card')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-import-strategy-row')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-import-strategy-merge')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-import-strategy-overwrite')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-export-row')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-import-row')).toBeInTheDocument();
  });

  it('toggles import strategy segmented controls（切换导入策略分段按钮）', () => {
    render(<NewSettingsPage />);

    const mergeButton = screen.getByTestId('new-settings-import-strategy-merge');
    const overwriteButton = screen.getByTestId('new-settings-import-strategy-overwrite');

    expect(mergeButton).toHaveAttribute('aria-pressed', 'true');
    expect(overwriteButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(overwriteButton);
    expect(overwriteButton).toHaveAttribute('aria-pressed', 'true');
    expect(mergeButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(mergeButton);
    expect(mergeButton).toHaveAttribute('aria-pressed', 'true');
    expect(overwriteButton).toHaveAttribute('aria-pressed', 'false');
  });
});
