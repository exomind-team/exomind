/**
 * Shared vi.mock() blocks for NewSettingsPage section tests.
 * Import this file (side-effect only) before importing the component under test.
 *
 * Usage:
 *   import './setup-settings-mocks';
 *   import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';
 *
 * If a test needs to override a specific mock (e.g. developer-mode),
 * call vi.mock() again AFTER this import — Vitest hoists all vi.mock()
 * calls and the last one for a given module wins.
 */
import { vi } from 'vitest';

vi.mock('@/lib/services', () => ({
  getEventLogService: vi.fn(() => ({
    exportEventsAsJson: vi.fn().mockResolvedValue('[]'),
    importEventsFromJson: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
  })),
}));

vi.mock('@/config/port-env', () => ({
  getSyncServerUrlOverride: vi.fn(() => null),
  resolveSyncServerUrl: vi.fn(() => 'http://localhost:5984'),
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
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: vi.fn(() => false),
  setDeveloperModeEnabled: vi.fn(),
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: vi.fn(() => false),
  setAgentPageEnabled: vi.fn(),
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

vi.mock('@/lib/debug/devtools-runtime', () => ({
  syncDevtoolsWithSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/config/ui-mode', () => ({
  setUIMode: vi.fn(),
}));

vi.mock('@/lib/media/timer-end-sounds', () => ({
  TIMER_END_SOUND_PRESETS: [],
  getTimerEndSoundPresetById: vi.fn(() => ({ label: 'Bell' })),
}));

vi.mock('@/ui/new/components/UserCard', () => ({
  UserCard: () => null,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: any) => open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
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
