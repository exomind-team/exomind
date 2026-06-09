import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  });

  it('does not show task backend enum row even in developer mode', () => {
    render(<SettingsPage />);

    expect(screen.queryByText('任务后端')).not.toBeInTheDocument();
  });

  it('keeps task backend row hidden when developer mode is off', () => {
    settingsPagePreferenceState.developerMode = false;
    render(<SettingsPage />);

    expect(screen.queryByText('任务后端')).not.toBeInTheDocument();
  });
});
