import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage voice section（语音分组设置）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsPagePreferenceState.developerMode = false;
    settingsPagePreferenceState.voiceShortcutAsrProvider = 'moss';
    settingsPagePreferenceState.voiceShortcutEnabled = true;
    settingsPagePreferenceState.voiceRuntimeEnabled = false;
    settingsPagePreferenceState.voiceRuntimeMode = 'push-to-talk';
    settingsPagePreferenceState.voiceRuntimeProvider = 'doubao-o2-realtime';

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
    expect(screen.getAllByText('常驻语音助手').length).toBeGreaterThan(0);

    expect(screen.queryByText('快捷语音引擎')).not.toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('启用常驻语音助手')).toBeInTheDocument();
  });

  it('shows shortcut voice input inline and switches provider panels（快捷语音输入在当前页直接展示并切换 provider）', async () => {
    render(<SettingsPage />);

    expect(screen.getByText('Provider / 服务提供方：MOSS')).toBeInTheDocument();
    expect(screen.getByText('启用快捷语音输入')).toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('MOSS 本地识别配置区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '火山' }));

    await waitFor(() => {
      expect(screen.getByText('火山 ASR 配置区')).toBeInTheDocument();
      expect(screen.getByText('火山引擎 Key')).toBeInTheDocument();
      expect(screen.getByText('火山识别模式')).toBeInTheDocument();
    });
  });

  it('shows assistant settings inline and reflects mode/provider changes（常驻语音助手在当前页直接展示并反映模式与 provider 切换）', async () => {
    render(<SettingsPage />);

    expect(screen.getByText('启用常驻语音助手')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-voice-runtime-cloud-session-policy-row')).toBeInTheDocument();
    expect(screen.getByText('Doubao App ID')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Omni Compatible' }));
    fireEvent.click(screen.getByRole('radio', { name: '环境监听' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Omni Compatible 当前只支持按键说话，不支持环境监听。');
      expect(screen.getByText('Omni Compatible 模型')).toBeInTheDocument();
      expect(screen.getByText('Omni Compatible Base URL')).toBeInTheDocument();
    });
  });

  it('shows assistant diagnostics rows only in developer mode（常驻助手诊断项仅在开发者模式出现）', () => {
    settingsPagePreferenceState.developerMode = true;

    render(<SettingsPage />);

    expect(screen.getByText('显示语音诊断入口')).toBeInTheDocument();
    expect(screen.getByText('打开语音诊断页')).toBeInTheDocument();
  });
});
