import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuickExitShortcutSetting } from '@/ui/app/components/settings/quick-exit-shortcut-setting';
import {
  getQuickExitShortcut,
  setQuickExitShortcut,
} from '@/config/quick-exit-shortcut';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));

vi.mock('@/services/quick-exit-shortcut-runtime', () => ({
  syncQuickExitShortcutWithRuntime: syncMock,
}));

describe('quick exit shortcut setting UI（快速退出快捷键设置界面）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
    syncMock.mockReset();
    syncMock.mockImplementation(async ({ hotkey }: { hotkey?: string | null }) =>
      hotkey ? { kind: 'valid', hotkey } : { kind: 'unassigned' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the current binding and captures a chord without dispatching exit', async () => {
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    expect(screen.getByText('未设置')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('不会等待前端未保存草稿');

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByLabelText(/正在捕获/);

    fireEvent.keyDown(captureButton, {
      key: 'A',
      code: 'KeyA',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(syncMock).toHaveBeenCalledWith({ hotkey: 'Ctrl+Shift+A' });
    expect(await screen.findByText(/已设置：Ctrl\+Shift\+A/)).toBeInTheDocument();
  });

  it('cancels capture on Escape without invoking the runtime', () => {
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByLabelText(/正在捕获/);

    fireEvent.keyDown(captureButton, { key: 'Escape' });

    expect(screen.getByText(/已取消/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/正在捕获/)).not.toBeInTheDocument();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('clears the binding on Backspace through the runtime', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByLabelText(/正在捕获/);

    fireEvent.keyDown(captureButton, { key: 'Backspace' });

    expect(syncMock).toHaveBeenCalledWith({ hotkey: null });
    expect(await screen.findByText(/已清除/)).toBeInTheDocument();
  });

  it('announces Command and captures it directly on macOS', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh; Intel Mac OS X 10_15_7' });
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByRole('button', {
      name: /正在捕获快捷键：快速退出快捷键；按下 Command \/ Ctrl \/ Alt \/ Shift/,
    });

    fireEvent.keyDown(captureButton, {
      key: 'A',
      code: 'KeyA',
      metaKey: true,
      shiftKey: true,
    });

    expect(syncMock).toHaveBeenCalledWith({ hotkey: 'Cmd+Shift+A' });
    expect(await screen.findByText(/已设置：Cmd\+Shift\+A/)).toBeInTheDocument();
  });

  it('preserves the old binding and shows an error when the runtime rejects a conflict', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    syncMock.mockRejectedValueOnce(new Error('与主窗口快捷键 Ctrl+E 冲突。'));
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByLabelText(/正在捕获/);

    fireEvent.keyDown(captureButton, {
      key: 'E',
      code: 'KeyE',
      ctrlKey: true,
    });

    expect(await screen.findByText(/与主窗口快捷键 Ctrl\+E 冲突。.*重试/)).toBeInTheDocument();
    expect(screen.queryByText(/已设置/)).not.toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+X')).toBeInTheDocument();
  });

  it('does not report success or change the persisted binding for a returned conflict status', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    syncMock.mockResolvedValueOnce({
      kind: 'conflict',
      message: '与主窗口快捷键 Ctrl+E 冲突。',
    });
    render(<QuickExitShortcutSetting ctx={{ isDesktop: true }} />);

    fireEvent.click(screen.getByTestId('new-settings-quick-exit-shortcut-row'));
    const captureButton = screen.getByLabelText(/正在捕获/);

    fireEvent.keyDown(captureButton, {
      key: 'E',
      code: 'KeyE',
      ctrlKey: true,
    });

    expect(await screen.findByText(/与主窗口快捷键 Ctrl\+E 冲突。.*重试/)).toBeInTheDocument();
    expect(screen.queryByText(/已设置/)).not.toBeInTheDocument();
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
    expect(screen.getByText('Ctrl+Alt+X')).toBeInTheDocument();
  });
});
