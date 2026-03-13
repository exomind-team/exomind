import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';
import { setTimeblockBackendMode } from '@/config/domain-backend-mode';

const reloadMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => false),
  invoke: vi.fn(),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage timeblock backend diagnostics (issue-485)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = true;
    settingsPageDomainBackendState.eventlog = 'rt-sqlite';
    settingsPageDomainBackendState.task = 'rt-sqlite';
    settingsPageDomainBackendState.timeblock = 'rt-sqlite';
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
    settingsPageServiceMocks.timeblockBackup.getBackendStatus.mockResolvedValue({
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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadMock,
      },
    });
  });

  it('shows timeblock backend diagnostics in developer mode', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('时间块后端：rt-sqlite')).toBeInTheDocument();
    });
    expect(screen.getByText('时间块备份：JSON / SQLite')).toBeInTheDocument();
  });

  it('switches timeblock backend mode and reloads the app', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('时间块后端：rt-sqlite')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'legacy' })[2]);

    expect(setTimeblockBackendMode).toHaveBeenCalledWith('legacy');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
