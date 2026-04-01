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
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
}));

import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage timeblock backend diagnostics (issue-485)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = true;
    settingsPagePreferenceState.isTauriWindow = true;
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

  it('shows timeblock backend enum row in developer mode', () => {
    render(<SettingsPage />);

    expect(screen.getByText('时间块后端')).toBeInTheDocument();
  });

  it('switches timeblock backend mode via dialog and reloads', async () => {
    render(<SettingsPage />);

    const row = screen.getByText('时间块后端').closest('button');
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '时间块后端' })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: '时间块后端' });
    const legacyButton = Array.from(dialog.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Legacy'),
    );
    expect(legacyButton).toBeDefined();
    fireEvent.click(legacyButton!);

    expect(setTimeblockBackendMode).toHaveBeenCalledWith('legacy');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
