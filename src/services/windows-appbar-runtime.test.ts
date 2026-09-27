import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { applyWindowsAppBarPreference } from './windows-appbar-runtime';

describe('Windows AppBar runtime（Windows 停靠运行时）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockResolvedValue(true);
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
  });

  it('attaches the current Tauri window with the configured width', async () => {
    await applyWindowsAppBarPreference({ enabled: true, widthDip: 360 });

    expect(invokeMock).toHaveBeenCalledWith('windows_appbar_attach_right', { widthDip: 360 });
  });

  it('detaches the current Tauri window when disabled', async () => {
    await applyWindowsAppBarPreference({ enabled: false, widthDip: 360 });

    expect(invokeMock).toHaveBeenCalledWith('windows_appbar_detach');
  });

  it('does not call native commands outside Tauri', async () => {
    isTauriMock.mockResolvedValue(false);

    await applyWindowsAppBarPreference({ enabled: true, widthDip: 360 });

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
