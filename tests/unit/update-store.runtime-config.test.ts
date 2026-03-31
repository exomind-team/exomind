import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAutoCheckStart, mockAutoCheckStop } = vi.hoisted(() => ({
  mockAutoCheckStart: vi.fn(),
  mockAutoCheckStop: vi.fn(),
}));

vi.mock('@/lib/services/update.service', () => ({
  checkForUpdate: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue('0.1.0'),
  getPlatform: vi.fn().mockReturnValue('windows-x64'),
  createAutoCheckController: vi.fn(() => ({
    start: mockAutoCheckStart,
    stop: mockAutoCheckStop,
  })),
}));

describe('update-store runtime-backed persistence（更新设置走 Runtime 持久化）', () => {
  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    const runtimeConfigCache = await import('@/config/runtime-config-cache');
    runtimeConfigCache.__resetRuntimeConfigCacheForTests();
  });

  it('hydrates persisted update settings from runtime config cache', async () => {
    const runtimeConfigCache = await import('@/config/runtime-config-cache');
    runtimeConfigCache.__primeRuntimeConfigForTests({
      'exomind-update-settings': JSON.stringify({
        state: {
          channel: 'preview',
          checkInterval: 'hourly',
          autoDownloadPreview: true,
          lastCheckTime: 123,
        },
        version: 0,
      }),
    });

    const { useUpdateStore } = await import('@/ui/stores/update-store');
    const state = useUpdateStore.getState();

    expect(state.channel).toBe('preview');
    expect(state.checkInterval).toBe('hourly');
    expect(state.autoDownloadPreview).toBe(true);
    expect(state.lastCheckTime).toBe(123);
  });
});
