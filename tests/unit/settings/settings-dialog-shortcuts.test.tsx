import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('Settings dialog shortcuts（设置弹窗快捷提交）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    settingsPagePreferenceState.voiceShortcutAsrProvider = 'volcano';
  });

  it('saves AI Registry from the notes textarea with Ctrl+Enter', async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('AI Registry').closest('button') as HTMLButtonElement);

    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-ai-registry-test' },
    });

    const notesTextarea = screen.getByPlaceholderText(
      '记录质量、价格、额度、代理稳定性等备注',
    );
    fireEvent.change(notesTextarea, {
      target: { value: '通过 Ctrl+Enter 保存 AI Registry 备注' },
    });

    fireEvent.keyDown(notesTextarea, { key: 'Enter' });
    expect(screen.queryByText(/AI Registry 已保存/)).not.toBeInTheDocument();

    fireEvent.keyDown(notesTextarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText(/AI Registry 已保存：/)).toBeInTheDocument();
    });
  });
});
