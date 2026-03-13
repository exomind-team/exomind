import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';
import { setEventlogBackendMode, setTaskBackendMode } from '@/config/domain-backend-mode';

const reloadMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => false),
  invoke: vi.fn(),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage eventlog backend diagnostics (issue-484)', () => {
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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadMock,
      },
    });
  });

  it('shows per-domain backend diagnostics in developer mode', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('事件日志后端：rt-sqlite')).toBeInTheDocument();
    });
    expect(screen.getByText('事件日志备份：JSON / SQLite')).toBeInTheDocument();
    expect(screen.getByText('任务后端：rt-sqlite')).toBeInTheDocument();
    expect(screen.getByText('时间块后端：legacy')).toBeInTheDocument();
  });

  it('hides backend diagnostics when developer mode is off', () => {
    settingsPagePreferenceState.developerMode = false;
    render(<SettingsPage />);

    expect(screen.queryByText(/事件日志后端：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/任务后端：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/时间块后端：/)).not.toBeInTheDocument();
  });

  it('switches eventlog backend mode per domain and reloads the app', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('事件日志后端：rt-sqlite')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'legacy' })[0]);

    expect(setEventlogBackendMode).toHaveBeenCalledWith('legacy');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('switches task backend mode without affecting eventlog mode', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('任务后端：rt-sqlite')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'legacy' })[1]);

    expect(setTaskBackendMode).toHaveBeenCalledWith('legacy');
    expect(setEventlogBackendMode).not.toHaveBeenCalledWith('legacy');
  });
});
