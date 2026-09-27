import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRuntimeTargetMode } from '@/config/runtime-target';

const getStatusMock = vi.fn();
const useSignalStreamMock = vi.fn();
const useNowWorkbenchOverlayControllerMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: vi.fn(),
    setSize: vi.fn(),
    onMoved: vi.fn(async () => () => {}),
    onFocusChanged: vi.fn(async () => () => {}),
    startDragging: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => ({
    getStatus: getStatusMock,
  }),
}));

vi.mock('@/ui/hooks/useSignalStream', () => ({
  useSignalStream: useSignalStreamMock,
}));

vi.mock('@/ui/app/overlay/use-now-workbench-overlay-controller', () => ({
  useNowWorkbenchOverlayController: useNowWorkbenchOverlayControllerMock,
}));

describe('NowWorkbenchOverlayPage runtime readiness（悬浮工作台 RT 启动门禁）', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    setRuntimeTargetMode('embedded');
    getStatusMock.mockReset();
    getStatusMock.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 0,
      error: 'starting',
    });
    useSignalStreamMock.mockReset();
    useNowWorkbenchOverlayControllerMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('does not mount overlay business hooks before embedded RT is running（RT 未运行前不挂载业务 hook）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');

    render(<NowWorkbenchOverlayPage />);

    expect(screen.getByTestId('now-overlay-runtime-starting')).toBeInTheDocument();
    expect(useNowWorkbenchOverlayControllerMock).not.toHaveBeenCalled();
    expect(useSignalStreamMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(getStatusMock).toHaveBeenCalled();
    });

    expect(useNowWorkbenchOverlayControllerMock).not.toHaveBeenCalled();
    expect(useSignalStreamMock).not.toHaveBeenCalled();
  });
});
