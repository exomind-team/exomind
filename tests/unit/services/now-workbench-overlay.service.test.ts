import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const preferenceState = {
  enabled: true,
  position: { x: 120, y: 240 } as { x: number; y: number } | null,
};

const enabledListeners = new Set<(value: boolean) => void>();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@/config/now-workbench-overlay-preferences', () => ({
  getNowWorkbenchOverlayEnabled: () => preferenceState.enabled,
  getNowWorkbenchOverlayPosition: () => preferenceState.position,
  setNowWorkbenchOverlayPosition: (value: { x: number; y: number }) => {
    preferenceState.position = value;
    return value;
  },
  subscribeNowWorkbenchOverlayEnabledChanges: (listener: (value: boolean) => void) => {
    enabledListeners.add(listener);
    return () => enabledListeners.delete(listener);
  },
  subscribeNowWorkbenchOverlayPositionChanges: () => () => {},
}));

describe('NowWorkbenchOverlayService（当下工作台悬浮窗服务）', () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    preferenceState.enabled = true;
    preferenceState.position = { x: 120, y: 240 };
    enabledListeners.clear();
  });

  it('creates and shows overlay on init when enabled（启用时初始化并显示悬浮窗）', async () => {
    const { createNowWorkbenchOverlayService } = await import('@/services/now-workbench-overlay.service');
    const service = createNowWorkbenchOverlayService();

    await service.init();

    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_ensure');
    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_set_position', { x: 120, y: 240 });
    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_show');
  });

  it('keeps manual hide session-local until explicitly reopened（临时隐藏仅作用于本次会话）', async () => {
    const { createNowWorkbenchOverlayService } = await import('@/services/now-workbench-overlay.service');
    const service = createNowWorkbenchOverlayService();

    await service.init();
    invokeMock.mockClear();

    await service.hideTemporarily();
    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_hide');

    invokeMock.mockClear();
    await service.syncVisibility();
    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_hide');
    expect(invokeMock).not.toHaveBeenCalledWith('now_workbench_overlay_show');
  });

  it('restores overlay near main window from main UI action（主窗口动作会恢复悬浮窗显示位置）', async () => {
    const { createNowWorkbenchOverlayService } = await import('@/services/now-workbench-overlay.service');
    const service = createNowWorkbenchOverlayService();

    await service.init();
    await service.hideTemporarily();
    invokeMock.mockClear();

    await service.reopenFromMainWindow();

    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_restore');
  });

  it('savePosition persists position and pushes one native update（显式保存位置时推送一次原生更新）', async () => {
    const { createNowWorkbenchOverlayService } = await import('@/services/now-workbench-overlay.service');
    const service = createNowWorkbenchOverlayService();

    invokeMock.mockClear();

    await service.savePosition({ x: 360, y: 480 });

    expect(invokeMock).toHaveBeenCalledWith('now_workbench_overlay_set_position', { x: 360, y: 480 });
  });
});
