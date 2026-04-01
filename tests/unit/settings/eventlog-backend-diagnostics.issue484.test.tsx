import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';
import { setEventlogBackendMode } from '@/config/domain-backend-mode';

const reloadMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage eventlog backend diagnostics (issue-484)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = true;
    settingsPagePreferenceState.isTauriWindow = true;
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

  it('shows per-domain backend enum rows in developer mode', () => {
    render(<SettingsPage />);

    expect(screen.getByText('事件日志后端')).toBeInTheDocument();
    expect(screen.getByText('任务后端')).toBeInTheDocument();
    expect(screen.getByText('时间块后端')).toBeInTheDocument();
  });

  it('hides backend rows when developer mode is off', () => {
    settingsPagePreferenceState.developerMode = false;
    render(<SettingsPage />);

    expect(screen.queryByText('事件日志后端')).not.toBeInTheDocument();
    expect(screen.queryByText('任务后端')).not.toBeInTheDocument();
    expect(screen.queryByText('时间块后端')).not.toBeInTheDocument();
  });

  it('switches eventlog backend mode via dialog and reloads', async () => {
    render(<SettingsPage />);

    const row = screen.getByText('事件日志后端').closest('button');
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '事件日志后端' })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: '事件日志后端' });
    const legacyButton = Array.from(dialog.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Legacy'),
    );
    expect(legacyButton).toBeDefined();
    fireEvent.click(legacyButton!);

    expect(setEventlogBackendMode).toHaveBeenCalledWith('legacy');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
