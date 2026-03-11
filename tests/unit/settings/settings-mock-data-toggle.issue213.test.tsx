import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  setUseMockDataEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn().mockResolvedValue(false),
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: vi.fn().mockResolvedValue('{}'),
    importEventsFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
  }),
  getTaskBackupService: () => ({
    exportTasksAsJson: vi.fn().mockResolvedValue({
      fileName: 'exomind-tasks.json',
      content: '{"version":1,"tasks":[]}',
      taskCount: 0,
    }),
    exportTasksAsSqliteSnapshot: vi.fn().mockResolvedValue({
      fileName: 'exomind-tasks.sqlite',
      bytes: new Uint8Array(),
      taskCount: 0,
    }),
    importTasksFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    importTasksFromSqliteSnapshot: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    getBackendStatus: vi.fn().mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    }),
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
  getDeveloperModeEnabled: () => true,
  setDeveloperModeEnabled: vi.fn(),
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: () => false,
  setAgentPageEnabled: vi.fn(),
}));

vi.mock('@/config/timer-preferences', () => ({
  getTimerPreferences: () => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: true,
    countdownEndSoundPresetId: 'ring-10',
  }),
  subscribeTimerPreferencesChanges: () => () => {},
  updateTimerPreferences: (value: unknown) => value,
}));

vi.mock('@/config/mock-data', () => ({
  getUseMockDataEnabled: () => false,
  setUseMockDataEnabled: mocks.setUseMockDataEnabled,
  subscribeUseMockDataChanges: () => () => {},
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('settings mock-data toggle issue-213（设置页测试数据开关）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows use-mock-data toggle when developer mode is enabled（开发者模式显示测试数据开关）', async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('使用测试数据')).toBeInTheDocument();
    });
  });

  it('calls setUseMockDataEnabled after toggle click（点击后更新 mock 开关）', async () => {
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('使用测试数据')).toBeInTheDocument();
    });
    const switchEl = screen.getByTestId('new-settings-use-mock-data-switch');
    fireEvent.click(switchEl);
    expect(mocks.setUseMockDataEnabled).toHaveBeenCalledWith(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
