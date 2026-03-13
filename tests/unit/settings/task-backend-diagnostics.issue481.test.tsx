import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const developerModeState = {
  enabled: true,
};

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
  setDeveloperModeEnabled: vi.fn((next: boolean) => { developerModeState.enabled = next; }),
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

describe('SettingsPage task backend diagnostics (issue-481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.getTaskBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    mocks.isTauri.mockResolvedValue(false);
    mocks.invoke.mockResolvedValue(null);
  });

  it('shows task backend diagnostics in developer mode', async () => {
    developerModeState.enabled = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('任务后端：rt-sqlite')).toBeInTheDocument();
    });
    expect(screen.getByText('任务备份：JSON / SQLite')).toBeInTheDocument();
  });

  it('hides task backend diagnostics when developer mode is off', () => {
    developerModeState.enabled = false;
    render(<SettingsPage />);

    expect(screen.queryByText(/任务后端：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/任务备份：/)).not.toBeInTheDocument();
  });
});
