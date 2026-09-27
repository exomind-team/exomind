import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage voice section（语音分组设置，火山-only）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPagePreferenceState.voiceShortcutAsrProvider = 'volcano';
    settingsPagePreferenceState.voiceShortcutEnabled = true;

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
  });

  it('moves voice configuration out of input section（语音配置不再平铺在输入分组）', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('new-settings-input-section')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-voice-section')).toBeInTheDocument();
    expect(screen.getAllByText('快捷语音输入').length).toBeGreaterThan(0);

    expect(screen.queryByText('快捷语音引擎')).not.toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('启用快捷语音输入')).toBeInTheDocument();
  });

  it('shows shortcut voice input inline with the volcano panel（快捷语音输入在当前页直接展示火山配置）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Provider / 服务提供方：火山')).toBeInTheDocument();
    expect(screen.getByText('启用快捷语音输入')).toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('火山 ASR 配置区')).toBeInTheDocument();
  });
});
