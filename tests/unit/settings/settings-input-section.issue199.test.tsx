import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { setVoiceTranscriptSendMode } from '@/config/voice-transcript-send-mode';
import { getVoiceShortcutHotkey, setVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { setVoiceShortcutAsrProvider } from '@/config/voice-shortcut-asr-provider';
import { setVolcanoResourceId } from '@/lib/asr/volcano-config';

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => false);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: (...args: unknown[]) => isTauriMock(...args),
}));

describe('SettingsPage input section（输入分组语音配置）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    isTauriMock.mockReturnValue(false);
    invokeMock.mockResolvedValue(null);
  });

  it('renders input section with voice-related rows', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('new-settings-input-section')).toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('全局语音快捷键')).toBeInTheDocument();
    expect(screen.getByText('快捷语音引擎')).toBeInTheDocument();
    expect(screen.getByText('MOSS API Token')).toBeInTheDocument();
    expect(screen.getByText('MOSS 语音测试')).toBeInTheDocument();
  });

  it('switches shortcut voice provider from input section', () => {
    render(<SettingsPage />);

    const volcanoButton = screen.getByTestId('new-settings-voice-provider-volcano');
    const mossButton = screen.getByTestId('new-settings-voice-provider-moss');

    fireEvent.click(volcanoButton);
    expect(volcanoButton).toHaveAttribute('aria-pressed', 'true');
    expect(mossButton).toHaveAttribute('aria-pressed', 'false');
    expect(setVoiceShortcutAsrProvider('volcano')).toBe('volcano');

    fireEvent.click(mossButton);
    expect(mossButton).toHaveAttribute('aria-pressed', 'true');
    expect(volcanoButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('allows selecting volcano resource model from input section', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-provider-volcano'));

    const select = screen.getByTestId('new-settings-volcano-resource-select');
    fireEvent.change(select, { target: { value: 'volc.bigasr.sauc.duration' } });

    expect(setVolcanoResourceId('volc.bigasr.sauc.duration')).toBe('volc.bigasr.sauc.duration');
    expect(screen.getByText('当前默认资源：模型 1.0 小时版。')).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('new-settings-voice-shortcut-alt-w'));
    return waitFor(() => {
      expect(setHotkeyMock).toHaveBeenCalledWith('Ctrl+Space');
      expect(setHotkeyMock).toHaveBeenCalledWith('Alt+W');
    });
  });

  it('reverts to runtime hotkey when tauri shortcut switch fails（Tauri 切换失败时回滚到实际快捷键）', async () => {
    isTauriMock.mockReturnValue(true);
    vi.mocked(getVoiceShortcutHotkey).mockReturnValue('Alt+Q');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'voice_shortcut_set') {
        throw new Error('shortcut already registered');
      }
      if (command === 'voice_shortcut_get') {
        return 'Alt+Q';
      }
      return null;
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-shortcut-ctrl-space'));

    await waitFor(() => {
      expect(screen.getByText('全局语音快捷键切换失败：shortcut already registered')).toBeInTheDocument();
    });
    expect(screen.getByTestId('new-settings-voice-shortcut-alt-q')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('new-settings-voice-shortcut-ctrl-space')).toHaveAttribute('aria-pressed', 'false');
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
