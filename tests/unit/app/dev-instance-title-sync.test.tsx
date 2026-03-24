import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  setTitle: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: mocks.setTitle,
  }),
}));

vi.mock('@/config/dev-instance-diagnostics', () => ({
  formatDevInstanceWindowTitle: () => 'ExoMind [dev] [Web:5173 RT:6984]',
  isDevInstanceDiagnosticsEnabled: () => true,
}));

describe('DevInstanceTitleSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = 'ExoMind';
  });

  it('updates tauri window title in dev mode（开发态同步 Tauri 窗口标题）', async () => {
    mocks.isTauri.mockResolvedValue(true);
    const { DevInstanceTitleSync } = await import('@/ui/app/components/DevInstanceTitleSync');

    render(<DevInstanceTitleSync />);

    await waitFor(() => expect(mocks.setTitle).toHaveBeenCalledWith('ExoMind [dev] [Web:5173 RT:6984]'));
  });

  it('updates document title for web preview（开发态同步浏览器标题）', async () => {
    mocks.isTauri.mockResolvedValue(false);
    const { DevInstanceTitleSync } = await import('@/ui/app/components/DevInstanceTitleSync');

    render(<DevInstanceTitleSync />);

    await waitFor(() => expect(document.title).toBe('ExoMind [dev] [Web:5173 RT:6984]'));
  });
});
