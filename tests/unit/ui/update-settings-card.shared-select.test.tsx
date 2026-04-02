import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateSettingsCard } from '@/ui/app/components/UpdateSettingsCard';
import { useUpdateStore } from '@/ui/stores/update-store';

describe('UpdateSettingsCard shared select（更新设置卡片共享下拉）', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      channel: 'release',
      checkInterval: 'daily',
      autoDownloadPreview: false,
      updateAvailable: null,
      lastCheckTime: null,
      isChecking: false,
      downloadProgress: null,
      toastDismissed: false,
      error: null,
    });
  });

  it('uses shared select for check interval and updates the store（检查频率走共享 Select 并更新 store）', async () => {
    const user = userEvent.setup();
    vi.spyOn(useUpdateStore.getState(), 'initAutoCheck');

    render(<UpdateSettingsCard />);

    const trigger = screen.getByRole('combobox', { name: '检查频率' });
    expect(trigger.tagName).not.toBe('SELECT');

    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: '每小时' }));

    expect(useUpdateStore.getState().checkInterval).toBe('hourly');
  });
});
