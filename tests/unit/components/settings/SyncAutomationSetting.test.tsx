import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { settingsPagePreferenceState } from './setup-settings-mocks.tsx';

describe('SettingsPage - Sync automation setting removal（设置页不再承载自动配对与自动同步入口）', () => {
  beforeEach(() => {
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPagePreferenceState.isDesktopOperatingSystem = true;
    settingsPagePreferenceState.syncAutomationEnabled = true;
  });

  it('does not render the sync automation control in settings page（设置页不再展示自动配对与自动同步开关）', async () => {
    await act(async () => {
      render(<SettingsPage />);
    });

    expect(screen.queryByText('自动配对与自动同步')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-settings-sync-automation-switch')).not.toBeInTheDocument();
  });
});
