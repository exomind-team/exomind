/**
 * NewSettingsPage - Legal Section 单元测试
 * GH#217: 新增 Legal Section（隐私政策/用户协议/官网/赞助/开源许可）
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock all heavy dependencies (same as MoreSection test)
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
  resolveVersionBuildInfo: vi.fn(() => ({ version: '0.3.3', buildTag: 'DEV' })),
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

describe('NewSettingsPage - Legal Section', () => {
  it('renders Legal section title', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('法律与支持')).toBeInTheDocument();
  });

  it('renders privacy policy row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('隐私政策')).toBeInTheDocument();
  });

  it('renders terms of service row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('用户协议')).toBeInTheDocument();
  });

  it('renders website row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('官网')).toBeInTheDocument();
  });

  it('renders sponsor row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('赞助开发者')).toBeInTheDocument();
  });

  it('renders open source license row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('开源软件使用声明')).toBeInTheDocument();
  });
});
