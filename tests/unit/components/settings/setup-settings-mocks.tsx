/**
 * Shared vi.mock() blocks for SettingsPage section tests.
 * Import this file (side-effect only) before importing the component under test.
 *
 * Usage:
 *   import './setup-settings-mocks';
 *   import { SettingsPage } from '@/ui/app/pages/SettingsPage';
 *
 * If a test needs to override a specific mock (e.g. developer-mode),
 * call vi.mock() again AFTER this import — Vitest hoists all vi.mock()
 * calls and the last one for a given module wins.
 */
import { vi } from 'vitest';

export const settingsPageServiceMocks = {
  dataTransfer: {
    exportBackup: vi.fn().mockResolvedValue('全部数据导出成功。'),
    importBackup: vi.fn().mockResolvedValue('全部数据导入成功。'),
  },
  eventLog: {
    exportEventsAsJson: vi.fn().mockResolvedValue('[]'),
    importEventsFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
  },
  eventlogBackup: {
    exportEventsAsJson: vi.fn().mockResolvedValue({
      fileName: 'exomind-eventlog.json',
      content: '{"version":1,"events":[]}',
      eventCount: 0,
    }),
    exportEventsAsSqliteSnapshot: vi.fn().mockResolvedValue({
      fileName: 'exomind-eventlog.sqlite',
      bytes: new Uint8Array(),
      eventCount: 0,
    }),
    importEventsFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    importEventsFromSqliteSnapshot: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, total: 0 }),
    getBackendStatus: vi.fn().mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    }),
  },
  taskBackup: {
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
  },
  timeblockBackup: {
    exportTimeBlocksAsJson: vi.fn().mockResolvedValue({
      fileName: 'exomind-timeblocks.json',
      content: '{"version":1,"time_blocks":[],"active_block":null}',
      timeBlockCount: 0,
      activeBlock: null,
    }),
    exportTimeBlocksAsSqliteSnapshot: vi.fn().mockResolvedValue({
      fileName: 'exomind-timeblocks.sqlite',
      bytes: new Uint8Array(),
      timeBlockCount: 0,
      activeBlockPresent: false,
    }),
    importTimeBlocksFromJson: vi.fn().mockResolvedValue({
      imported: 0,
      skipped: 0,
      total: 0,
      activeBlockUpdated: false,
    }),
    importTimeBlocksFromSqliteSnapshot: vi.fn().mockResolvedValue({
      imported: 0,
      skipped: 0,
      total: 0,
      activeBlockUpdated: false,
    }),
    getBackendStatus: vi.fn().mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    }),
  },
};

export const settingsPagePreferenceState = {
  developerMode: false,
  agentPageEnabled: false,
  mePageEnabled: false,
  desktopAdaptiveEnabled: true,
  voiceShortcutAsrProvider: 'moss' as string,
};

export const settingsPageDomainBackendState = {
  eventlog: 'rt-sqlite' as const,
  task: 'rt-sqlite' as const,
  timeblock: 'rt-sqlite' as const,
};

vi.mock('@/lib/services', () => ({
  getEventLogService: vi.fn(() => ({
    exportEventsAsJson: settingsPageServiceMocks.eventLog.exportEventsAsJson,
    importEventsFromJson: settingsPageServiceMocks.eventLog.importEventsFromJson,
  })),
  getEventLogBackupService: vi.fn(() => settingsPageServiceMocks.eventlogBackup),
  getTimeBlockBackupService: vi.fn(() => settingsPageServiceMocks.timeblockBackup),
  getTaskBackupService: vi.fn(() => ({
    exportTasksAsJson: settingsPageServiceMocks.taskBackup.exportTasksAsJson,
    exportTasksAsSqliteSnapshot: settingsPageServiceMocks.taskBackup.exportTasksAsSqliteSnapshot,
    importTasksFromJson: settingsPageServiceMocks.taskBackup.importTasksFromJson,
    importTasksFromSqliteSnapshot: settingsPageServiceMocks.taskBackup.importTasksFromSqliteSnapshot,
    getBackendStatus: settingsPageServiceMocks.taskBackup.getBackendStatus,
  })),
}));

vi.mock('@/config/domain-backend-mode', () => ({
  getEventlogBackendMode: vi.fn(() => settingsPageDomainBackendState.eventlog),
  setEventlogBackendMode: vi.fn((value: 'legacy' | 'rt-sqlite') => {
    settingsPageDomainBackendState.eventlog = value;
    return value;
  }),
  getTaskBackendMode: vi.fn(() => settingsPageDomainBackendState.task),
  setTaskBackendMode: vi.fn((value: 'legacy' | 'rt-sqlite') => {
    settingsPageDomainBackendState.task = value;
    return value;
  }),
  getTimeblockBackendMode: vi.fn(() => settingsPageDomainBackendState.timeblock),
  setTimeblockBackendMode: vi.fn((value: 'legacy' | 'rt-sqlite') => {
    settingsPageDomainBackendState.timeblock = value;
    return value;
  }),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: vi.fn(() => null),
  resolveSyncServerUrl: vi.fn(() => 'http://localhost:5984'),
  resolveAsrServerUrl: vi.fn(() => 'http://localhost:1949'),
  setSyncServerUrlOverride: vi.fn(),
}));

vi.mock('@/config/version-build-info', () => ({
  resolveVersionBuildInfo: vi.fn(() => ({
    appVersion: '0.3.3',
    buildHash: 'abc1234',
  })),
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: vi.fn(() => 'system'),
  setThemePreference: vi.fn(),
  subscribeThemePreferenceChanges: vi.fn(() => () => {}),
}));

vi.mock('@/services/impl/settings-data-service', () => ({
  exportBackup: vi.fn(() => settingsPageServiceMocks.dataTransfer.exportBackup()),
  importBackup: vi.fn((strategy: 'merge' | 'overwrite') => settingsPageServiceMocks.dataTransfer.importBackup(strategy)),
  importBackupFromContent: vi.fn((content: string, sourcePath: string, strategy: 'merge' | 'overwrite') =>
    settingsPageServiceMocks.dataTransfer.importBackup({ content, sourcePath, strategy })),
  importTasksFromFile: vi.fn(),
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: vi.fn(() => settingsPagePreferenceState.developerMode),
  setDeveloperModeEnabled: vi.fn(),
  subscribeDeveloperModeChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: vi.fn(() => settingsPagePreferenceState.agentPageEnabled),
  setAgentPageEnabled: vi.fn(),
  subscribeAgentPageEnabledChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/me-page-enabled', () => ({
  getMePageEnabled: vi.fn(() => settingsPagePreferenceState.mePageEnabled),
  setMePageEnabled: vi.fn(),
  subscribeMePageEnabledChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/desktop-adaptive', () => ({
  getDesktopAdaptiveEnabled: vi.fn(() => settingsPagePreferenceState.desktopAdaptiveEnabled),
  setDesktopAdaptiveEnabled: vi.fn(),
  subscribeDesktopAdaptiveChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/timer-preferences', () => ({
  getTimerPreferences: vi.fn(() => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'bell-gentle',
  })),
  subscribeTimerPreferencesChanges: vi.fn(() => () => {}),
  updateTimerPreferences: vi.fn((p: any) => p),
}));

vi.mock('@/config/focus-bgm-preferences', () => ({
  getFocusBgmPreferences: vi.fn(() => ({
    enabled: false,
    sourceType: 'preset',
    presetId: 'white-noise',
    customTracks: [],
    playbackMode: 'loop',
    stopBehavior: 'manual-end',
    volume: 60,
  })),
  subscribeFocusBgmPreferencesChanges: vi.fn(() => () => {}),
  updateFocusBgmPreferences: vi.fn((patch: any) => patch),
}));

vi.mock('@/lib/media/focus-bgm-file-picker', () => ({
  pickFocusBgmTracks: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/config/mock-data', () => ({
  getUseMockDataEnabled: vi.fn(() => false),
  setUseMockDataEnabled: vi.fn(),
  subscribeUseMockDataChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/devtools-mode', () => ({
  getDevtoolsEnabled: vi.fn(() => false),
  setDevtoolsEnabled: vi.fn(),
  subscribeDevtoolsChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: vi.fn(() => false),
  setCommandPaletteEnabled: vi.fn(),
  subscribeCommandPaletteEnabledChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/llm-settings', () => ({
  getLLMApiKey: vi.fn(() => ''),
  getLLMBaseUrl: vi.fn(() => 'https://api.openai.com/v1'),
  getLLMModel: vi.fn(() => 'gpt-4o'),
  setLLMApiKey: vi.fn(),
  setLLMBaseUrl: vi.fn(),
  setLLMModel: vi.fn(),
  subscribeLLMSettingsChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-transcript-send-mode', () => ({
  getVoiceTranscriptSendMode: vi.fn(() => 'insert'),
  setVoiceTranscriptSendMode: vi.fn(),
  subscribeVoiceTranscriptSendModeChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/input-send-mode', () => ({
  getInputSendMode: vi.fn(() => 'ctrl-enter-send'),
  setInputSendMode: vi.fn((value: string) => value),
  subscribeInputSendModeChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/task-page-fuzzy-search', () => ({
  getTaskPageFuzzySearchEnabled: vi.fn(() => true),
  setTaskPageFuzzySearchEnabled: vi.fn((value: boolean) => value),
  subscribeTaskPageFuzzySearchChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/task-create-success-action', () => ({
  getTaskCreateSuccessAction: vi.fn(() => 'refocus'),
  setTaskCreateSuccessAction: vi.fn((value: string) => value),
  subscribeTaskCreateSuccessActionChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-shortcut-send-mode', () => ({
  getVoiceShortcutSendMode: vi.fn(() => 'insert-only'),
  setVoiceShortcutSendMode: vi.fn((value: string) => value),
  subscribeVoiceShortcutSendModeChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  VOICE_SHORTCUT_HOTKEY_VALUES: ['Alt+Q', 'Alt+W', 'Ctrl+Space'],
  getVoiceShortcutHotkey: vi.fn(() => 'Alt+Q'),
  setVoiceShortcutHotkey: vi.fn((value: string) => value),
  subscribeVoiceShortcutHotkeyChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-shortcut-asr-provider', () => {
  const listeners = new Set<(value: string) => void>();
  return {
    getVoiceShortcutAsrProvider: vi.fn(() => settingsPagePreferenceState.voiceShortcutAsrProvider),
    getVoiceShortcutAsrProviderLabel: vi.fn((value: string) => {
      const labels: Record<string, string> = { moss: 'MOSS', volcano: '火山' };
      return labels[value] ?? value;
    }),
    setVoiceShortcutAsrProvider: vi.fn((value: string) => {
      settingsPagePreferenceState.voiceShortcutAsrProvider = value;
      listeners.forEach((listener) => listener(value));
      return value;
    }),
    subscribeVoiceShortcutAsrProviderChanges: vi.fn((listener: (value: string) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
  };
});

vi.mock('@/config/voice-overlay-preferences', () => ({
  DEFAULT_VOICE_OVERLAY_OPACITY: 62,
  MIN_VOICE_OVERLAY_OPACITY: 32,
  MAX_VOICE_OVERLAY_OPACITY: 92,
  DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES: 3,
  MIN_VOICE_OVERLAY_TRANSCRIPT_LINES: 1,
  MAX_VOICE_OVERLAY_TRANSCRIPT_LINES: 5,
  DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET: 56,
  MIN_VOICE_OVERLAY_BOTTOM_OFFSET: 24,
  MAX_VOICE_OVERLAY_BOTTOM_OFFSET: 160,
  getVoiceOverlayOpacity: vi.fn(() => 62),
  setVoiceOverlayOpacity: vi.fn((value: number) => value),
  getVoiceOverlayShowDiagnostics: vi.fn(() => false),
  setVoiceOverlayShowDiagnostics: vi.fn((value: boolean) => value),
  getVoiceOverlayTranscriptLines: vi.fn(() => 3),
  setVoiceOverlayTranscriptLines: vi.fn((value: number) => value),
  getVoiceOverlayBottomOffset: vi.fn(() => 56),
  setVoiceOverlayBottomOffset: vi.fn((value: number) => value),
  subscribeVoiceOverlayOpacityChanges: vi.fn(() => () => {}),
  subscribeVoiceOverlayShowDiagnosticsChanges: vi.fn(() => () => {}),
  subscribeVoiceOverlayTranscriptLinesChanges: vi.fn(() => () => {}),
  subscribeVoiceOverlayBottomOffsetChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/voice-shortcut-mic-prewarm', () => ({
  getVoiceShortcutMicPrewarmEnabled: vi.fn(() => true),
  setVoiceShortcutMicPrewarmEnabled: vi.fn(),
  subscribeVoiceShortcutMicPrewarmChanges: vi.fn(() => () => {}),
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: vi.fn(() => ({
    timingInfoEnabled: false,
    statisticsEnabled: false,
    quickFeedbackEnabled: true,
  })),
  setFeedbackPreferences: vi.fn(),
  subscribeFeedbackPreferencesChanges: vi.fn(() => () => {}),
}));

vi.mock('@/lib/debug/devtools-runtime', () => ({
  syncDevtoolsWithSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  attachLogger: vi.fn(),
}));

vi.mock('@/lib/media/timer-end-sounds', () => ({
  TIMER_END_SOUND_PRESETS: [],
  getTimerEndSoundPresetById: vi.fn(() => ({ label: 'Bell' })),
}));

vi.mock('@/ui/app/components/UserCard', () => ({
  UserCard: () => null,
}));

vi.mock('@/ui/app/config/settings/LogPanelDialog', () => ({
  LogPanelDialog: () => null,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock('@/components/ui/dialog', () => {
  let dialogTitleText = '';
  return {
    Dialog: ({ children, open }: any) => {
      if (!open) return null;
      dialogTitleText = '';
      return <div data-testid="dialog">{children}</div>;
    },
    DialogContent: ({ children }: any) => {
      const ref = (node: HTMLElement | null) => {
        if (node && dialogTitleText) {
          node.setAttribute('aria-label', dialogTitleText);
        }
      };
      return <div role="dialog" ref={ref}>{children}</div>;
    },
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => {
      dialogTitleText = String(children);
      return <div role="heading">{children}</div>;
    },
    DialogDescription: ({ children, className }: any) => <div className={className}>{children}</div>,
  };
});

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: any) => open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: any) => <div>{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
  DrawerDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));
