import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

function installStorageStub(storage: Record<string, string>): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const key of Object.keys(storage)) {
          delete storage[key];
        }
      },
      key: (index: number) => Object.keys(storage)[index] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    },
  });
}

function installScreenStub(width: number, height: number): void {
  Object.defineProperty(window, 'screen', {
    configurable: true,
    value: {
      availWidth: width,
      availHeight: height,
      width,
      height,
    },
  });
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('now workbench overlay preferences（当下工作台悬浮窗偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    storage = {};
    installStorageStub(storage);
    installScreenStub(1440, 900);
    isTauriMock.mockResolvedValue(false);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
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
    expect(storage[module.NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY]).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('reads runtime-backed enabled and position before localStorage（优先读取 Runtime 中的工作台悬浮窗配置）', async () => {
    storage['exomind:nowWorkbenchOverlayEnabled'] = 'false';
    storage['exomind:nowWorkbenchOverlayPosition'] = '{"x":120,"y":240,"displaySignature":"1440x900"}';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:nowWorkbenchOverlayEnabled': 'true',
      'exomind:nowWorkbenchOverlayPosition': '{"x":360,"y":480,"displaySignature":"1440x900"}',
    });

    const module = await import('@/config/now-workbench-overlay-preferences');

    expect(module.getNowWorkbenchOverlayEnabled()).toBe(true);
    expect(module.getNowWorkbenchOverlayPosition()).toEqual({ x: 360, y: 480 });
  });

  it('persists and emits saved position（持久化并广播窗口位置）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayPositionChanges(listener);

    expect(module.setNowWorkbenchOverlayPosition({ x: 120, y: 240 })).toEqual({ x: 120, y: 240 });
    expect(storage[module.NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY]).toBe('{"x":120,"y":240,"displaySignature":"1440x900"}');
    expect(listener).toHaveBeenCalledWith({ x: 120, y: 240 });
    expect(module.getNowWorkbenchOverlayPosition()).toEqual({ x: 120, y: 240 });

    unsubscribe();
  });

  it('persists position through runtime config transport and keeps local mirror（位置写入 Runtime 并保留本地镜像）', async () => {
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'exomind:nowWorkbenchOverlayPosition',
        value: '{"x":300,"y":420,"displaySignature":"1440x900"}',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    const module = await import('@/config/now-workbench-overlay-preferences');

    expect(module.setNowWorkbenchOverlayPosition({ x: 300, y: 420 })).toEqual({ x: 300, y: 420 });
    await flushMicrotasks();

    expect(storage[module.NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY]).toBe('{"x":300,"y":420,"displaySignature":"1440x900"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/exomind%3AnowWorkbenchOverlayPosition');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
  });

  it('notifies position subscribers when retry bootstrap replaces fallback values（重试启动成功后会通知工作台悬浮窗位置订阅者）', async () => {
    vi.useFakeTimers();
    storage['exomind:nowWorkbenchOverlayPosition'] = '{"x":120,"y":240,"displaySignature":"1440x900"}';
    isTauriMock.mockResolvedValue(true);

    let runtimeReady = false;
    invokeMock.mockImplementation(async () => {
      if (!runtimeReady) {
        return {
          running: false,
          host: '127.0.0.1',
          port: 9124,
          authSecret: 'secret-123',
        };
      }

      return {
        running: true,
        host: '127.0.0.1',
        port: 9124,
        authSecret: 'secret-123',
      };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, skipped: 1, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:nowWorkbenchOverlayPosition', value: '{"x":640,"y":720,"displaySignature":"1440x900"}' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayPositionChanges(listener);
    const cacheModule = await import('@/config/runtime-config-cache');

    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(module.getNowWorkbenchOverlayPosition()).toEqual({ x: 120, y: 240 });
    expect(listener).not.toHaveBeenCalled();

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(module.getNowWorkbenchOverlayPosition()).toEqual({ x: 640, y: 720 });
    expect(listener).toHaveBeenCalledWith({ x: 640, y: 720 });

    unsubscribe();
    vi.useRealTimers();
  });

  it('syncs position through storage events（位置支持 storage 事件同步）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeNowWorkbenchOverlayPositionChanges(listener);

    storage[module.NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY] = '{"x":360,"y":480,"displaySignature":"1440x900"}';
    window.dispatchEvent(new StorageEvent('storage', {
      key: module.NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY,
      newValue: '{"x":360,"y":480,"displaySignature":"1440x900"}',
    }));

    expect(listener).toHaveBeenCalledWith({ x: 360, y: 480 });
    unsubscribe();
  });

  it('ignores Windows hidden-window sentinel position when reading（读取 Windows 隐藏窗口哨兵坐标时忽略）', async () => {
    storage['exomind:nowWorkbenchOverlayPosition'] = '{"x":-32000,"y":-32000,"displaySignature":"1440x900"}';
    const module = await import('@/config/now-workbench-overlay-preferences');

    expect(module.getNowWorkbenchOverlayPosition()).toBeNull();
  });

  it('does not persist Windows hidden-window sentinel position（不持久化 Windows 隐藏窗口哨兵坐标）', async () => {
    const module = await import('@/config/now-workbench-overlay-preferences');

    expect(module.setNowWorkbenchOverlayPosition({ x: -32000, y: -32000 })).toBeNull();
    expect(storage[module.NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY]).toBeUndefined();
  });

  it('ignores overlay positions saved for another display signature or legacy payload shape（不同显示环境或旧版 payload 的位置不会复用）', async () => {
    storage['exomind:nowWorkbenchOverlayPosition'] = '{"x":120,"y":240}';
    const module = await import('@/config/now-workbench-overlay-preferences');
    expect(module.getNowWorkbenchOverlayPosition()).toBeNull();

    storage['exomind:nowWorkbenchOverlayPosition'] = '{"x":320,"y":480,"displaySignature":"1920x1080"}';
    expect(module.getNowWorkbenchOverlayPosition()).toBeNull();
  });
});
