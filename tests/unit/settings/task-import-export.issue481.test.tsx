import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  exportEventsAsJson: vi.fn(),
  importEventsFromJson: vi.fn(),
  exportTasksAsJson: vi.fn(),
  exportTasksAsSqliteSnapshot: vi.fn(),
  importTasksFromJson: vi.fn(),
  importTasksFromSqliteSnapshot: vi.fn(),
  getTaskBackendStatus: vi.fn(),
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

const developerModeState = vi.hoisted(() => ({
  enabled: true,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: mocks.exportEventsAsJson,
    importEventsFromJson: mocks.importEventsFromJson,
  }),
  getTaskBackupService: () => ({
    exportTasksAsJson: mocks.exportTasksAsJson,
    exportTasksAsSqliteSnapshot: mocks.exportTasksAsSqliteSnapshot,
    importTasksFromJson: mocks.importTasksFromJson,
    importTasksFromSqliteSnapshot: mocks.importTasksFromSqliteSnapshot,
    getBackendStatus: mocks.getTaskBackendStatus,
  }),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: () => null,
  resolveSyncServerUrl: () => 'http://127.0.0.1:6984',
  resolveAsrServerUrl: () => 'http://127.0.0.1:1949',
  setSyncServerUrlOverride: vi.fn(),
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: () => 'system',
  setThemePreference: vi.fn(),
  subscribeThemePreferenceChanges: () => () => {},
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => developerModeState.enabled,
  setDeveloperModeEnabled: vi.fn(),
  subscribeDeveloperModeChanges: () => () => {},
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: () => false,
  setAgentPageEnabled: vi.fn(),
  subscribeAgentPageEnabledChanges: () => () => {},
}));

vi.mock('@/config/desktop-adaptive', () => ({
  getDesktopAdaptiveEnabled: () => true,
  setDesktopAdaptiveEnabled: vi.fn(),
  subscribeDesktopAdaptiveChanges: () => () => {},
}));

vi.mock('@/config/mock-data', () => ({
  getUseMockDataEnabled: () => false,
  setUseMockDataEnabled: vi.fn(),
  subscribeUseMockDataChanges: () => () => {},
}));

vi.mock('@/config/timer-preferences', () => ({
  getTimerPreferences: () => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'timer-end-ring-10',
  }),
  subscribeTimerPreferencesChanges: () => () => {},
  updateTimerPreferences: (partial: Record<string, unknown>) => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'timer-end-ring-10',
    ...partial,
  }),
}));

vi.mock('@/config/devtools-mode', () => ({
  getDevtoolsEnabled: () => false,
  setDevtoolsEnabled: vi.fn(),
  subscribeDevtoolsChanges: () => () => {},
}));

vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: () => false,
  setCommandPaletteEnabled: vi.fn(),
  subscribeCommandPaletteEnabledChanges: () => () => {},
}));

vi.mock('@/config/voice-transcript-send-mode', () => ({
  getVoiceTranscriptSendMode: () => 'insert',
  setVoiceTranscriptSendMode: vi.fn(),
  subscribeVoiceTranscriptSendModeChanges: () => () => {},
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  VOICE_SHORTCUT_HOTKEY_VALUES: ['Alt+Q', 'Alt+W', 'Ctrl+Space'],
  getVoiceShortcutHotkey: () => 'Alt+Q',
  setVoiceShortcutHotkey: vi.fn(),
  subscribeVoiceShortcutHotkeyChanges: () => () => {},
}));

vi.mock('@/config/voice-shortcut-send-mode', () => ({
  getVoiceShortcutSendMode: () => 'insert-only',
  setVoiceShortcutSendMode: vi.fn(),
  subscribeVoiceShortcutSendModeChanges: () => () => {},
}));

vi.mock('@/config/voice-shortcut-mic-prewarm', () => ({
  getVoiceShortcutMicPrewarmEnabled: () => true,
  setVoiceShortcutMicPrewarmEnabled: vi.fn(),
  subscribeVoiceShortcutMicPrewarmChanges: () => () => {},
}));

vi.mock('@/config/voice-overlay-preferences', () => ({
  DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET: 56,
  getVoiceOverlayOpacity: () => 62,
  getVoiceOverlayShowDiagnostics: () => false,
  getVoiceOverlayTranscriptLines: () => 3,
  getVoiceOverlayBottomOffset: () => 56,
  MAX_VOICE_OVERLAY_OPACITY: 92,
  MIN_VOICE_OVERLAY_OPACITY: 32,
  MAX_VOICE_OVERLAY_BOTTOM_OFFSET: 160,
  subscribeVoiceOverlayOpacityChanges: () => () => {},
  subscribeVoiceOverlayBottomOffsetChanges: () => () => {},
  subscribeVoiceOverlayShowDiagnosticsChanges: () => () => {},
  subscribeVoiceOverlayTranscriptLinesChanges: () => () => {},
  setVoiceOverlayOpacity: vi.fn(),
  setVoiceOverlayShowDiagnostics: vi.fn(),
  setVoiceOverlayTranscriptLines: vi.fn(),
  setVoiceOverlayBottomOffset: vi.fn(),
  MAX_VOICE_OVERLAY_TRANSCRIPT_LINES: 5,
  MIN_VOICE_OVERLAY_BOTTOM_OFFSET: 24,
  MIN_VOICE_OVERLAY_TRANSCRIPT_LINES: 1,
}));

vi.mock('@/config/voice-shortcut-asr-provider', () => ({
  getVoiceShortcutAsrProvider: () => 'volcano',
  getVoiceShortcutAsrProviderLabel: () => 'Volcano',
  setVoiceShortcutAsrProvider: vi.fn(),
  subscribeVoiceShortcutAsrProviderChanges: () => () => {},
}));

vi.mock('@/lib/asr/volcano-config', () => ({
  DEFAULT_VOLCANO_RESOURCE_ID: 'volc.default',
  VOLCANO_RESOURCE_PRESETS: [{ value: 'volc.default', label: 'Volcano Default' }],
  getVolcanoResourceId: () => 'volc.default',
  setVolcanoResourceId: vi.fn((value: string) => value),
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: () => ({
    timingInfoEnabled: false,
    statisticsEnabled: false,
    quickFeedbackEnabled: true,
  }),
  setFeedbackPreferences: vi.fn(),
  subscribeFeedbackPreferencesChanges: () => () => {},
}));

vi.mock('@/config/version-build-info', () => ({
  resolveVersionBuildInfo: () => ({
    appVersion: '0.3.6',
    buildHash: 'issue481',
  }),
}));

vi.mock('@/lib/debug/devtools-runtime', () => ({
  syncDevtoolsWithSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/media/timer-end-sounds', () => ({
  TIMER_END_SOUND_PRESETS: [],
  getTimerEndSoundPresetById: vi.fn(() => ({ label: 'Bell' })),
}));

vi.mock('@/ui/app/components/UserCard', () => ({
  UserCard: () => <div data-testid="mock-user-card" />,
}));

vi.mock('@/ui/app/components/MoreSection', () => ({
  MoreSection: () => null,
}));

vi.mock('@/ui/app/components/LegalSection', () => ({
  LegalSection: () => null,
}));

vi.mock('@/ui/app/components/AboutSection', () => ({
  AboutSection: () => null,
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

const createObjectURLMock = vi.fn(() => 'blob:task-backup');
const revokeObjectURLMock = vi.fn();

Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
});

describe('SettingsPage task import/export (issue-481)', () => {
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    developerModeState.enabled = true;
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
    mocks.exportEventsAsJson.mockResolvedValue(JSON.stringify({ events: [] }));
    mocks.importEventsFromJson.mockResolvedValue({ imported: 0, skipped: 0, total: 0 });
    mocks.exportTasksAsJson.mockResolvedValue({
      fileName: 'exomind-tasks-2026-03-11.json',
      content: JSON.stringify({ version: 1, tasks: [] }),
      taskCount: 0,
    });
    mocks.exportTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: 'exomind-tasks.sqlite',
      bytes: new Uint8Array([1, 2, 3]),
      taskCount: 1,
    });
    mocks.importTasksFromJson.mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
    mocks.importTasksFromSqliteSnapshot.mockResolvedValue({ imported: 2, skipped: 0, total: 2 });
    mocks.getTaskBackendStatus.mockReturnValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    anchorClickSpy.mockRestore();
  });

  it('exports task backup as JSON', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出任务 JSON' }));

    await waitFor(() => {
      expect(mocks.exportTasksAsJson).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('任务导出成功（JSON），共 0 条任务。')).toBeInTheDocument();
  });

  it('uses tauri native save command for JSON export in tauri runtime', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue('D:/Downloads/exomind-tasks-2026-03-11.json');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出任务 JSON' }));

    await waitFor(() => {
      expect(
        mocks.invoke.mock.calls.some(([command, payload]) =>
          command === 'save_json_file'
          && JSON.stringify(payload) === JSON.stringify({
            content: JSON.stringify({ version: 1, tasks: [] }),
            defaultName: 'exomind-tasks-2026-03-11.json',
          })
        )
      ).toBe(true);
    });

    expect(anchorClickSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/任务导出成功（JSON），共 0 条任务。保存路径：/)).toBeInTheDocument();
  });

  it('exports task backup as SQLite snapshot', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出任务 SQLite' }));

    await waitFor(() => {
      expect(mocks.exportTasksAsSqliteSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('任务导出成功（SQLite），共 1 条任务。')).toBeInTheDocument();
  });

  it('uses tauri native save command for SQLite export in tauri runtime', async () => {
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue('D:/Downloads/exomind-tasks.sqlite');

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出任务 SQLite' }));

    await waitFor(() => {
      expect(
        mocks.invoke.mock.calls.some(([command, payload]) =>
          command === 'save_binary_file'
          && JSON.stringify(payload) === JSON.stringify({
            content: [1, 2, 3],
            defaultName: 'exomind-tasks.sqlite',
            filters: ['sqlite', 'db'],
          })
        )
      ).toBe(true);
    });

    expect(anchorClickSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/任务导出成功（SQLite），共 1 条任务。保存路径：/)).toBeInTheDocument();
  });

  it('imports task backup from JSON file', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入任务数据' }));

    const input = screen.getByTestId('new-settings-task-import-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 1, tasks: [] })], 'tasks.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.importTasksFromJson).toHaveBeenCalledWith(expect.stringContaining('"tasks"'), 'merge');
    });
    expect(screen.getByText(/任务导入成功：新增 1 条，跳过 0 条，当前共 1 条。来源：tasks\.json/)).toBeInTheDocument();
  });

  it('imports task backup from SQLite snapshot file', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '导入任务数据' }));

    const input = screen.getByTestId('new-settings-task-import-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'tasks.sqlite', {
      type: 'application/octet-stream',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.importTasksFromSqliteSnapshot).toHaveBeenCalledWith(expect.any(Uint8Array), 'merge');
    });
    expect(screen.getByText(/任务导入成功：新增 2 条，跳过 0 条，当前共 2 条。来源：tasks\.sqlite/)).toBeInTheDocument();
  });

  it('hides task-only import/export entries when developer mode is disabled', () => {
    developerModeState.enabled = false;

    render(<SettingsPage />);

    expect(screen.queryByText('导出任务 JSON')).not.toBeInTheDocument();
    expect(screen.queryByText('导出任务 SQLite')).not.toBeInTheDocument();
    expect(screen.queryByText('导入任务数据')).not.toBeInTheDocument();
  });
});
