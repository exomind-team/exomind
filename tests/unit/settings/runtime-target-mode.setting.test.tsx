import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { settingsPagePreferenceState } from '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

const invokeMock = vi.fn();
const isTauriMock = vi.fn(async () => true);
const runtimeControlMocks = {
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  getStatus: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: (...args: unknown[]) => isTauriMock(...args),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

describe('SettingsPage runtime target mode setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    settingsPagePreferenceState.isTauriWindow = true;
    settingsPagePreferenceState.isDesktopOperatingSystem = false;
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string, payload?: { mode?: string }) => {
      if (command === 'runtime_target_mode_set') {
        return payload?.mode ?? 'embedded';
      }
      if (command === 'voice_shortcut_get' || command === 'main_window_shortcut_get') {
        return null;
      }
      return 'local';
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
    });
    runtimeControlMocks.stopRuntime.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 9124,
    });
    runtimeControlMocks.getStatus.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 9124,
    });
  });

  it('shows terminal agent as its own settings section and toggles visible fields', async () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '连接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终端 Agent' })).toBeInTheDocument();
    expect(screen.getByText('连接方式')).toBeInTheDocument();
    expect(screen.getByText('本机开放范围')).toBeInTheDocument();
    expect(screen.getByText('超时待决策时间')).toBeInTheDocument();
    expect(screen.getByText('控制 PTY 连续无输出多久后自动标记为等待决策。')).toBeInTheDocument();
    expect(screen.getByText('终端历史回放上限')).toBeInTheDocument();
    expect(screen.queryByText('RT 地址')).toBeNull();

    const inputSection = screen.getByTestId('new-settings-desktop-vc-section-input');
    const terminalAgentSection = screen.getByTestId('new-settings-desktop-vc-section-terminal-agent');

    expect(within(inputSection).queryByText('平铺工作台方向快捷键')).toBeNull();
    expect(within(inputSection).queryByText('平铺工作台命令快捷键')).toBeNull();
    expect(within(inputSection).queryByText('平铺工作台单次透传快捷键')).toBeNull();
    expect(within(terminalAgentSection).getByText('平铺工作台方向快捷键')).toBeInTheDocument();
    expect(within(terminalAgentSection).getByText('平铺工作台命令快捷键')).toBeInTheDocument();
    expect(within(terminalAgentSection).getByText('平铺工作台单次透传快捷键')).toBeInTheDocument();

    fireEvent.click(screen.getByText('连接方式'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '连接方式' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('外部'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('runtime_target_mode_set', { mode: 'external' });
      expect(runtimeControlMocks.stopRuntime).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('RT 地址')).toBeInTheDocument();
      expect(screen.queryByText('本机开放范围')).toBeNull();
      expect(screen.getByRole('button', { name: '终端 Agent' })).toBeInTheDocument();
      expect(screen.queryByText('超时待决策时间')).toBeNull();
      expect(screen.queryByText('终端历史回放上限')).toBeNull();
      expect(within(screen.getByTestId('new-settings-desktop-vc-section-terminal-agent')).getByText('平铺工作台方向快捷键')).toBeInTheDocument();
      expect(within(screen.getByTestId('new-settings-desktop-vc-section-terminal-agent')).getByText('平铺工作台命令快捷键')).toBeInTheDocument();
      expect(within(screen.getByTestId('new-settings-desktop-vc-section-terminal-agent')).getByText('平铺工作台单次透传快捷键')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('连接方式'));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '连接方式' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('内置'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('runtime_target_mode_set', { mode: 'embedded' });
      expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 9124,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('本机开放范围')).toBeInTheDocument();
      expect(screen.queryByText('RT 地址')).toBeNull();
      expect(screen.getByRole('button', { name: '终端 Agent' })).toBeInTheDocument();
      expect(screen.getByText('超时待决策时间')).toBeInTheDocument();
      expect(screen.getByText('终端历史回放上限')).toBeInTheDocument();
    });
  });

  it('hides RT configuration entry outside tauri', () => {
    settingsPagePreferenceState.isTauriWindow = false;

    render(<SettingsPage />);

    expect(screen.queryByText('连接方式')).toBeNull();
    expect(screen.queryByText('本机开放范围')).toBeNull();
  });
});
