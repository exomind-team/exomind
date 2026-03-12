import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('now workbench overlay preferences（当下工作台悬浮窗偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
      },
    });
  });

  it('defaults to enabled for desktop overlay（默认启用桌面悬浮工作台）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');

    expect(module.getNowWorkbenchOverlayEnabled()).toBe(true);
  });

  it('persists and emits enabled changes（持久化并广播启用开关）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayEnabledChanges(listener);

    expect(module.setNowWorkbenchOverlayEnabled(false)).toBe(false);
    expect(storage['exomind:nowWorkbenchOverlayEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('persists and emits saved position（持久化并广播窗口位置）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayPositionChanges(listener);

    expect(module.setNowWorkbenchOverlayPosition({ x: 120, y: 240 })).toEqual({ x: 120, y: 240 });
    expect(storage['exomind:nowWorkbenchOverlayPosition']).toBe('{"x":120,"y":240}');
    expect(listener).toHaveBeenCalledWith({ x: 120, y: 240 });
    expect(module.getNowWorkbenchOverlayPosition()).toEqual({ x: 120, y: 240 });

    unsubscribe();
  });

  it('syncs position through storage events（位置支持 storage 事件同步）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayPositionChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:nowWorkbenchOverlayPosition',
      newValue: '{"x":360,"y":480}',
    }));

    expect(listener).toHaveBeenCalledWith({ x: 360, y: 480 });
    unsubscribe();
  });
});
