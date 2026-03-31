import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY } from '@/config/runtime-target';

const invokeMock = vi.fn();
const isTauriMock = vi.fn(async () => true);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: (...args: unknown[]) => isTauriMock(...args),
}));

describe('SettingsPage runtime open mode setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPagePreferenceState.isDesktopOperatingSystem = false;
    invokeMock.mockResolvedValue('lan');
    isTauriMock.mockResolvedValue(true);
  });

  it('shows RT open mode only in tauri and persists lan mode via native command', async () => {
    render(<SettingsPage />);

    expect(screen.getByText('RT 开放模式')).toBeInTheDocument();

    fireEvent.click(screen.getByText('RT 开放模式'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'RT 开放模式' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('局域网'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('runtime_network_mode_set', { mode: 'lan' });
      expect(window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY)).toBe('lan');
    });
  });

  it('hides RT open mode in non-tauri settings context', () => {
    settingsPagePreferenceState.isTauriWindow = false;

    render(<SettingsPage />);

    expect(screen.queryByText('RT 开放模式')).toBeNull();
  });
});
