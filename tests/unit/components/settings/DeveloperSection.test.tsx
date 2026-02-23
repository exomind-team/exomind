/**
 * NewSettingsPage - Developer Section 单元测试
 * GH#217: Developer Section 对齐设计稿 — 功能开关行 + 旧版页面行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
  resolveVersionBuildInfo: vi.fn(() => ({ version: '0.3.3', buildTag: 'DEV', appVersion: '0.3.3', buildHash: 'abc123' })),
}));

vi.mock('@/config/theme', () => ({
  getThemePreference: vi.fn(() => 'system'),
  setThemePreference: vi.fn(),
}));

// Developer mode ON by default for these tests
const mockGetDeveloperModeEnabled = vi.fn(() => true);
vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => mockGetDeveloperModeEnabled(),
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

vi.mock('@/config/ui-mode', () => ({
  setUIMode: vi.fn(),
}));

vi.mock('@/lib/media/timer-end-sounds', () => ({
  TIMER_END_SOUND_PRESETS: [],
  getTimerEndSoundPresetById: vi.fn(() => ({ label: 'Bell' })),
}));

vi.mock('@/ui/new/components/UserCard', () => ({
  UserCard: () => <div data-testid="user-card" />,
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

import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

describe('NewSettingsPage - Developer Section (developerMode=true)', () => {
  it('renders feature toggles row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('功能开关')).toBeInTheDocument();
  });

  it('opens feature toggles dialog on click', () => {
    render(<NewSettingsPage />);
    const row = screen.getByText('功能开关');
    fireEvent.click(row);
    expect(screen.getByText('Agent 页面')).toBeInTheDocument();
  });

  it('renders mock data toggle', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('使用测试数据')).toBeInTheDocument();
  });
});
