import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { setVoiceTranscriptSendMode } from '@/config/voice-transcript-send-mode';
import { setVoiceShortcutSendMode } from '@/config/voice-shortcut-send-mode';
import { getVoiceShortcutHotkey, setVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { setVoiceShortcutAsrProvider } from '@/config/voice-shortcut-asr-provider';
import { setVoiceShortcutMicPrewarmEnabled } from '@/config/voice-shortcut-mic-prewarm';
import {
  setVoiceOverlayOpacity,
  setVoiceOverlayBottomOffset,
  setVoiceOverlayShowDiagnostics,
  setVoiceOverlayTranscriptLines,
} from '@/config/voice-overlay-preferences';
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
    setVoiceShortcutAsrProvider('moss');
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
    expect(screen.getByText('聊天与外部输入语音完成后')).toBeInTheDocument();
    expect(screen.getByText('全局语音快捷键')).toBeInTheDocument();
    expect(screen.getByText('快捷语音引擎')).toBeInTheDocument();
    expect(screen.getByText('预启动麦克风')).toBeInTheDocument();
    expect(screen.getByText('悬浮窗透明度')).toBeInTheDocument();
    expect(screen.getByText('显示语音悬浮窗诊断信息')).toBeInTheDocument();
    expect(screen.getByText('悬浮窗实时文本行数')).toBeInTheDocument();
    expect(screen.getByText('悬浮窗距任务栏间距')).toBeInTheDocument();
    expect(screen.getByText('MOSS API Token')).toBeInTheDocument();
    expect(screen.getByText('仅作用于「当下」页面输入框，默认插入输入框')).toBeInTheDocument();
    expect(screen.getByText('Shortcut Voice（快捷键语音）默认 Alt+Q，按一次开始再按一次结束')).toBeInTheDocument();
    expect(screen.queryByText('MOSS 语音测试')).not.toBeInTheDocument();
    expect(screen.queryByText('火山引擎 ASR 测试')).not.toBeInTheDocument();
  });

  it('shows voice test rows only when developer mode is enabled', () => {
    vi.mocked(getDeveloperModeEnabled).mockReturnValue(true);

    render(<SettingsPage />);

    expect(screen.getByText('MOSS 语音测试')).toBeInTheDocument();
    expect(screen.getByText('火山引擎 ASR 测试')).toBeInTheDocument();
    expect(screen.getAllByText('可用')).toHaveLength(2);
  });

  it('switches shortcut voice provider from input section', async () => {
    const setProviderMock = vi.mocked(setVoiceShortcutAsrProvider);
    render(<SettingsPage />);

    const volcanoButton = screen.getByTestId('new-settings-voice-provider-volcano');
    const mossButton = screen.getByTestId('new-settings-voice-provider-moss');

    fireEvent.click(volcanoButton);
    await waitFor(() => {
      expect(volcanoButton).toHaveAttribute('aria-pressed', 'true');
      expect(mossButton).toHaveAttribute('aria-pressed', 'false');
    });
    expect(setProviderMock).toHaveBeenCalledWith('volcano');

    fireEvent.click(mossButton);
    await waitFor(() => {
      expect(mossButton).toHaveAttribute('aria-pressed', 'true');
      expect(volcanoButton).toHaveAttribute('aria-pressed', 'false');
    });
    expect(setProviderMock).toHaveBeenCalledWith('moss');
  });

  it('allows selecting volcano resource model from input section', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-provider-volcano'));

    const group = screen.getByRole('group', { name: '火山资源模型' });
    expect(screen.queryByTestId('new-settings-volcano-resource-select')).toBeNull();
    expect(screen.queryByText('模型 1.0 小时版')).toBeNull();
    expect(screen.getByRole('button', { name: '1.0 小时版' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.0 并发版' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2.0 小时版' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2.0 并发版' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1.0 小时版' }));

    expect(setVolcanoResourceId('volc.bigasr.sauc.duration')).toBe('volc.bigasr.sauc.duration');
    expect(group).toBeInTheDocument();
    expect(screen.getByText('当前默认资源：1.0 小时版。')).toBeInTheDocument();
  });

  it('updates voice overlay opacity from input section', () => {
    render(<SettingsPage />);

    const slider = screen.getByTestId('new-settings-voice-overlay-opacity-slider');
    expect(slider).toHaveAttribute('min', '32');
    expect(slider).toHaveAttribute('max', '92');
    fireEvent.change(slider, { target: { value: '74' } });

    expect(setVoiceOverlayOpacity(74)).toBe(74);
    expect(screen.getByText('74%')).toBeInTheDocument();
  });

  it('toggles chat and external input send mode from input section', () => {
    const setModeMock = vi.mocked(setVoiceShortcutSendMode);
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-shortcut-send-mode-auto-enter-send'));

    expect(setModeMock).toHaveBeenCalledWith('auto-enter-send');
    expect(screen.getByTestId('new-settings-voice-shortcut-send-mode-auto-enter-send')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles overlay diagnostics visibility from input section', () => {
    const setDiagnosticsMock = vi.mocked(setVoiceOverlayShowDiagnostics);
    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('new-settings-voice-overlay-diagnostics-switch'));

    expect(setDiagnosticsMock).toHaveBeenCalledWith(true);
  });

  it('updates overlay transcript line count from input section', () => {
    const setLinesMock = vi.mocked(setVoiceOverlayTranscriptLines);
    render(<SettingsPage />);

    const slider = screen.getByTestId('new-settings-voice-overlay-transcript-lines-slider');
    fireEvent.change(slider, { target: { value: '5' } });

    expect(setLinesMock).toHaveBeenCalledWith(5);
    expect(screen.getByText('5 行')).toBeInTheDocument();
  });

  it('updates overlay bottom offset from input section', () => {
    const setOffsetMock = vi.mocked(setVoiceOverlayBottomOffset);
    render(<SettingsPage />);

    const slider = screen.getByTestId('new-settings-voice-overlay-bottom-offset-slider');
    fireEvent.change(slider, { target: { value: '72' } });

    expect(setOffsetMock).toHaveBeenCalledWith(72);
    expect(screen.getByText('72px')).toBeInTheDocument();
  });

  it('toggles microphone prewarm from input section', () => {
    render(<SettingsPage />);

    const prewarmSwitch = screen.getByTestId('new-settings-voice-prewarm-switch');
    fireEvent.click(prewarmSwitch);

    expect(setVoiceShortcutMicPrewarmEnabled).toHaveBeenCalledWith(false);
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

  it('syncs hotkey from runtime on mount in tauri（Tauri 挂载时同步运行时快捷键）', async () => {
    const setHotkeyMock = vi.mocked(setVoiceShortcutHotkey);
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'voice_shortcut_get') {
        return 'Ctrl+Space';
      }
      return null;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('voice_shortcut_get');
    });
    expect(setHotkeyMock).toHaveBeenCalledWith('Ctrl+Space');
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

    const tokenRow = screen.getByTestId('new-settings-voice-token-row');
    expect(tokenRow.querySelector('.lucide-key')).not.toBeNull();
    expect(tokenRow.querySelector('.lucide-bot')).toBeNull();

    fireEvent.click(screen.getByText('MOSS API Token'));
    expect(screen.getByText('语音输入设置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示 Token' })).toBeInTheDocument();
    expect(screen.getByText('用于新 UI 语音输入转写')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清空' })).toBeInTheDocument();

    const tokenInput = screen.getByPlaceholderText('输入 MOSS API Token');
    fireEvent.change(tokenInput, { target: { value: 'Bearer sk-test-123456' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('MOSS API Token 已保存')).toBeInTheDocument();
    expect(screen.getByText('已配置 (sk-t***56)')).toBeInTheDocument();
  });

  it('keeps sync server dialog as plain single-value editor without secret-only footer controls', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('同步服务器'));

    expect(screen.getByText('设置事件日志同步的服务器地址')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示 Token' })).toBeNull();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();

    const syncInput = screen.getByPlaceholderText('http://127.0.0.1:6984');
    expect(syncInput).toHaveAttribute('type', 'url');

    const cancelButton = screen.getByRole('button', { name: '取消' });
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(cancelButton.className).toContain('flex-1');
    expect(saveButton.className).toContain('flex-1');
  });

  it('hides voice test rows when developer mode is disabled', () => {
    vi.mocked(getDeveloperModeEnabled).mockReturnValue(false);

    render(<SettingsPage />);

    expect(screen.queryByText('MOSS 语音测试')).not.toBeInTheDocument();
    expect(screen.queryByText('火山引擎 ASR 测试')).not.toBeInTheDocument();
  });

  it('renders the new voice settings in desktop layout（桌面布局也包含新增语音设置项）', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<SettingsPage />);

    expect(screen.getByText('聊天与外部输入语音完成后')).toBeInTheDocument();
    expect(screen.getByText('显示语音悬浮窗诊断信息')).toBeInTheDocument();
    expect(screen.getByText('悬浮窗实时文本行数')).toBeInTheDocument();
    expect(screen.getByText('悬浮窗距任务栏间距')).toBeInTheDocument();
  });

  it('uses dev dialog input classes for AI settings fields（AI 设置输入框严格复用 dev 焦点样式）', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('AI API Key').closest('button') as HTMLButtonElement);

    const apiKeyInput = screen.getByPlaceholderText('sk-...');
    const baseUrlInput = screen.getByPlaceholderText('https://api.openai.com/v1');
    const modelInput = screen.getByPlaceholderText('gpt-4o');

    for (const input of [apiKeyInput, baseUrlInput, modelInput]) {
      expect(input.className).toContain('border-[#F0ECE8]');
      expect(input.className).toContain('bg-white');
      expect(input.className).toContain('text-[#1C1917]');
      expect(input.className).toContain('placeholder:text-[#D6D3D1]');
      expect(input.className).toContain('focus:border-[#C75B3A]');
      expect(input.className).toContain('focus:ring-1');
      expect(input.className).toContain('focus:ring-[#C75B3A]');
      expect(input.className).toContain('dark:border-[#292524]');
      expect(input.className).toContain('dark:bg-[#1C1917]');
      expect(input.className).toContain('dark:text-[#FAFAF9]');
      expect(input.className).toContain('dark:placeholder:text-[#57534E]');
    }
  });
});
