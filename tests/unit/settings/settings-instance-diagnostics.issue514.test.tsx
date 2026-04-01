import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const developerModeState = {
  enabled: true,
};

const mocks = vi.hoisted(() => ({
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

vi.mock('@/config/dev-instance-diagnostics', () => ({
  getDevInstanceDiagnosticsSnapshot: (runtime?: { pid?: number | null }) => ({
    branch: 'feature/issue-514-instance-diagnostics',
    worktreeName: 'issue-514-instance-diagnostics',
    webPort: 5173,
    rtPort: 6984,
    mcpPort: 9232,
    asrServerUrl: 'http://localhost:1949',
    pid: runtime?.pid ?? null,
    envStatus: {
      VITE_MOSS_API_KEY: { sensitive: true, configured: false },
      VITE_VOLCANO_APP_KEY: { sensitive: true, configured: true },
      EXOMIND_RT_SECRET: { sensitive: true, configured: true },
    },
  }),
  isDevInstanceDiagnosticsEnabled: () => true,
}));

vi.mock('@/lib/dev-instance-runtime', () => ({
  loadTauriRuntimeInstanceDiagnostics: vi.fn(async () => ({
    pid: 43120,
  })),
}));

const backendStatusStub = { backend: 'rt-sqlite', supportsJsonBackup: true, supportsSqliteSnapshot: true };

vi.mock('@/lib/services', () => ({
  getEventLogService: () => ({
    exportEventsAsJson: vi.fn().mockResolvedValue('[]'),
    importEventsFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
  }),
  getEventLogBackupService: () => ({ getBackendStatus: vi.fn().mockResolvedValue(backendStatusStub) }),
  getTaskBackupService: () => ({
    exportTasksAsJson: vi.fn().mockResolvedValue({ fileName: 'exomind-tasks.json', content: '{}', taskCount: 0 }),
    exportTasksAsSqliteSnapshot: vi.fn().mockResolvedValue({ fileName: 'exomind-tasks.sqlite', bytes: new Uint8Array(), taskCount: 0 }),
    importTasksFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    importTasksFromSqliteSnapshot: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    getBackendStatus: vi.fn().mockResolvedValue(backendStatusStub),
  }),
  getTimeBlockBackupService: () => ({ getBackendStatus: vi.fn().mockResolvedValue(backendStatusStub) }),
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
    countdownEndSoundPresetId: 'ring-10',
  }),
  subscribeTimerPreferencesChanges: () => () => {},
  updateTimerPreferences: vi.fn((patch: Record<string, unknown>) => patch),
}));

vi.mock('@/config/focus-bgm-preferences', () => ({
  getFocusBgmPreferences: () => ({
    enabled: false,
    sourceType: 'preset',
    presetId: 'white-noise',
    customTracks: [],
    playbackMode: 'loop',
    stopBehavior: 'manual-end',
    volume: 60,
  }),
  subscribeFocusBgmPreferencesChanges: () => () => {},
  updateFocusBgmPreferences: vi.fn((patch: Record<string, unknown>) => patch),
}));

vi.mock('@/lib/media/focus-bgm-file-picker', () => ({
  pickFocusBgmTracks: vi.fn().mockResolvedValue([]),
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

vi.mock('@/config/input-send-mode', () => ({
  getInputSendMode: () => 'ctrl-enter-send',
  setInputSendMode: vi.fn(),
  subscribeInputSendModeChanges: () => () => {},
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  VOICE_SHORTCUT_HOTKEY_VALUES: ['Alt+Q', 'Alt+W'],
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

vi.mock('@/lib/asr/volcano-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asr/volcano-config')>();
  return {
    ...actual,
    DEFAULT_VOLCANO_RESOURCE_ID: 'volc.default',
    VOLCANO_RESOURCE_PRESETS: [{ value: 'volc.default', label: 'Volcano Default' }],
    getVolcanoResourceId: () => 'volc.default',
    setVolcanoResourceId: vi.fn((value: string) => value),
  };
});

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
    buildHash: 'issue514',
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
  UserCard: () => null,
}));

vi.mock('@/ui/app/components/MoreSection', () => ({
  MoreSection: () => null,
}));

vi.mock('@/ui/app/components/AboutSection', () => ({
  AboutSection: () => null,
}));

vi.mock('@/ui/app/config/settings/LogPanelDialog', () => ({
  LogPanelDialog: () => null,
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('issue-514 instance diagnostics setting（实例诊断设置项）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    developerModeState.enabled = true;
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
    mocks.isTauri.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue({ pid: 43120 });
  });

  it('shows the diagnostics entry in developer section and opens details（开发者分组展示实例诊断条目并可打开详情）', async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '开发者' }));
    fireEvent.click(screen.getByRole('button', { name: /实例诊断信息/ }));

    await waitFor(() => {
      expect(screen.getByText('feature/issue-514-instance-diagnostics')).toBeInTheDocument();
    });

    expect(screen.getByText('5173')).toBeInTheDocument();
    expect(screen.getByText('6984')).toBeInTheDocument();
    expect(screen.getByText('9232')).toBeInTheDocument();
    expect(screen.getByText('issue-514-instance-diagnostics')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('43120')).toBeInTheDocument());
    expect(screen.getAllByText('已配置').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未配置').length).toBeGreaterThan(0);
  });
});
