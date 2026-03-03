import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
  setThemePreference: vi.fn(),
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
  setThemePreference: mocks.setThemePreference,
  resolveThemePreference: (pref: string) => pref === 'system' ? 'light' : pref,
  subscribeThemePreferenceChanges: () => () => {},
  subscribeSystemThemeChanges: () => () => {},
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => false,
  setDeveloperModeEnabled: vi.fn(),
}));

vi.mock('@/config/desktop-adaptive', () => ({
  getDesktopAdaptiveEnabled: () => false,
  setDesktopAdaptiveEnabled: vi.fn(),
}));

vi.mock('@/ui/pages/UserManagePage', () => ({
  UserManagePage: () => <div data-testid="user-manage-page-mock">UserManagePage</div>,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

function clearLocalStorageSafely() {
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.clear === 'function') {
    storage.clear();
    return;
  }
  if (typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') {
    return;
  }
  const keys: string[] = [];
  const length = typeof storage.length === 'number' ? storage.length : 0;
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem?.(key));
}

describe('SettingsPage timer card（新设置页计时器卡片）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
    clearLocalStorageSafely();
  });

  it('renders end-mode segmented controls from pencil（显示结束模式分段切换）', () => {
    render(<SettingsPage />);

    const trigger = screen.getByText('倒计时结束').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    const dialog = screen.getByRole('dialog', { name: '倒计时结束模式' });
    expect(within(dialog).getByText('选择倒计时结束后的行为')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /硬停止/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /柔和提醒/ })).toBeInTheDocument();
  });

  it('toggles theme segmented controls and persists preference（切换主题分段按钮并持久化）', () => {
    render(<SettingsPage />);

    const systemButton = screen.getByTestId('new-settings-theme-system');
    const lightButton = screen.getByTestId('new-settings-theme-light');
    const darkButton = screen.getByTestId('new-settings-theme-dark');

    expect(systemButton).toHaveAttribute('aria-pressed', 'true');
    expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    expect(darkButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(lightButton);
    expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.setThemePreference).toHaveBeenCalledWith('light');

    fireEvent.click(darkButton);
    expect(darkButton).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.setThemePreference).toHaveBeenCalledWith('dark');
  });

  it('toggles end mode and persists selection（切换结束模式并持久化）', () => {
    render(<SettingsPage />);

    const trigger = screen.getByText('倒计时结束').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    const hardButton = screen.getByRole('button', { name: /硬停止/ });
    fireEvent.click(hardButton);

    const hardRaw = window.localStorage.getItem('exomind:timerPreferences');
    expect(hardRaw).not.toBeNull();
    expect(JSON.parse(hardRaw || '{}').countdownEndMode).toBe('hard');

    fireEvent.click(trigger as HTMLButtonElement);
    const softButton = screen.getByRole('button', { name: /柔和提醒/ });
    fireEvent.click(softButton);

    const softRaw = window.localStorage.getItem('exomind:timerPreferences');
    expect(softRaw).not.toBeNull();
    expect(JSON.parse(softRaw || '{}').countdownEndMode).toBe('soft');
  });

  it('opens sound picker and updates selected preset（提示音可打开选择并更新）', () => {
    render(<SettingsPage />);

    const trigger = screen.getByText('提示音').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    const dialog = screen.getByRole('dialog', { name: '选择提示音' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ring 10' }));

    expect(screen.getByText('Ring 10')).toBeInTheDocument();
  });

  it('renders import-export section in new row style（导入导出区使用新行式风格）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('数据')).toBeInTheDocument();
    expect(screen.getByText('导出备份')).toBeInTheDocument();
    expect(screen.getByText('导入数据')).toBeInTheDocument();
  });

  it('removes legacy import strategy segmented controls（移除旧导入策略分段按钮）', () => {
    render(<SettingsPage />);

    expect(screen.queryByTestId('new-settings-import-strategy-merge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-import-strategy-overwrite')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-end-mode-hard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-end-mode-soft')).not.toBeInTheDocument();
  });
});
