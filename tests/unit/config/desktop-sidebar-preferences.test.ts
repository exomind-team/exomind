import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('desktop sidebar preferences（桌面侧栏偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to expanded sidebar（默认展开侧栏）', async () => {
    const module = await import('@/config/desktop-sidebar-preferences');

    expect(module.getDesktopSidebarCollapsed()).toBe(false);
  });

  it('reads runtime-backed collapse state before local mirror（优先读取 Runtime 中的侧栏折叠状态）', async () => {
    storage['exomind:desktop-sidebar-collapsed'] = '0';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:desktop-sidebar-collapsed': '1',
    });

    const module = await import('@/config/desktop-sidebar-preferences');

    expect(module.getDesktopSidebarCollapsed()).toBe(true);
  });

  it('writes collapse state through runtime-preferred storage（折叠状态通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/desktop-sidebar-preferences');

    expect(module.setDesktopSidebarCollapsed(true)).toBe(true);
    expect(storage[module.DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY]).toBe('1');
    expect(module.setDesktopSidebarCollapsed(false)).toBe(false);
    expect(storage[module.DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY]).toBe('0');
  });
});
