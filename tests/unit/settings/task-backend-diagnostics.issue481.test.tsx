import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import {
  settingsPageDomainBackendState,
  settingsPagePreferenceState,
  settingsPageServiceMocks,
} from '../components/settings/setup-settings-mocks';
import { setTaskBackendMode } from '@/config/domain-backend-mode';

const reloadMock = vi.fn();

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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadMock,
      },
    });
  });

  it('shows task backend enum row in developer mode', () => {
    render(<SettingsPage />);

    expect(screen.getByText('任务后端')).toBeInTheDocument();
  });

  it('hides task backend row when developer mode is off', () => {
    settingsPagePreferenceState.developerMode = false;
    render(<SettingsPage />);

    expect(screen.queryByText('任务后端')).not.toBeInTheDocument();
  });

  it('switches task backend mode via dialog and reloads', async () => {
    render(<SettingsPage />);

    const row = screen.getByText('任务后端').closest('button');
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '任务后端' })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: '任务后端' });
    const legacyButton = Array.from(dialog.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Legacy'),
    );
    expect(legacyButton).toBeDefined();
    fireEvent.click(legacyButton!);

    expect(setTaskBackendMode).toHaveBeenCalledWith('legacy');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
