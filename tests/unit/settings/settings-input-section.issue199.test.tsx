import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { setVoiceTranscriptSendMode } from '@/config/voice-transcript-send-mode';
import { setVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';

describe('SettingsPage input section（输入分组语音配置）', () => {
  beforeEach(() => {
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

    const storage = window.localStorage as Partial<Storage>;
    if (typeof storage.removeItem === 'function') {
      storage.removeItem('moss_api_key');
    }
  });

  it('renders input section with voice-related rows', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('new-settings-input-section')).toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('全局语音快捷键')).toBeInTheDocument();
    expect(screen.getByText('MOSS API Token')).toBeInTheDocument();
    expect(screen.getByText('MOSS 语音测试')).toBeInTheDocument();
  });

  it('toggles voice transcript send mode from input section', () => {
    const setModeMock = vi.mocked(setVoiceTranscriptSendMode);
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-transcript-mode-direct-send'));
    expect(setModeMock).toHaveBeenCalledWith('direct-send');

    fireEvent.click(screen.getByTestId('new-settings-voice-transcript-mode-insert'));
    expect(setModeMock).toHaveBeenCalledWith('insert');
  });

  it('updates global voice shortcut from input section', () => {
    const setHotkeyMock = vi.mocked(setVoiceShortcutHotkey);
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-shortcut-ctrl-space'));
    expect(setHotkeyMock).toHaveBeenCalledWith('Ctrl+Space');

    fireEvent.click(screen.getByTestId('new-settings-voice-shortcut-alt-w'));
    expect(setHotkeyMock).toHaveBeenCalledWith('Alt+W');
  });

  it('saves MOSS token from input settings dialog', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('MOSS API Token'));
    expect(screen.getByText('语音输入设置')).toBeInTheDocument();

    const tokenInput = screen.getByPlaceholderText('输入 MOSS API Token');
    fireEvent.change(tokenInput, { target: { value: 'Bearer sk-test-123456' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('MOSS API Token 已保存')).toBeInTheDocument();
    expect(screen.getByText('已配置 (sk-t***56)')).toBeInTheDocument();
  });

  it('shows guidance when voice test is clicked without developer mode', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('MOSS 语音测试'));

    expect(screen.getByText('请先开启开发者模式后使用语音测试')).toBeInTheDocument();
  });
});
