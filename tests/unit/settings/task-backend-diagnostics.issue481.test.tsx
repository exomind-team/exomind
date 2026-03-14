import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage task backend diagnostics (issue-481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = true;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'legacy';
    settingsPageServiceMocks.eventlogBackup.getBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
    settingsPageServiceMocks.taskBackup.getBackendStatus.mockResolvedValue({
      backend: 'rt-sqlite',
      supportsJsonBackup: true,
      supportsSqliteSnapshot: true,
    });
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
  });

  it('shows task backend diagnostics in developer mode', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('任务后端：rt-sqlite')).toBeInTheDocument();
    });
    expect(screen.getByText('任务备份：JSON / SQLite')).toBeInTheDocument();
  });

  it('hides task backend diagnostics when developer mode is off', () => {
    settingsPagePreferenceState.developerMode = false;
    render(<SettingsPage />);

    expect(screen.queryByText(/任务后端：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/任务备份：/)).not.toBeInTheDocument();
  });
});
