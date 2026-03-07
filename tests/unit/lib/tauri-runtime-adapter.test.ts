import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY } from '@/config/runtime-target';
import { TauriRuntimeAdapter } from '@/lib/adapters/tauri-runtime-adapter';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => true),
  invoke: invokeMock,
}));

describe('TauriRuntimeAdapter（Tauri 运行时适配器）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
  });

  it('persists authSecret from runtime status（持久化运行时鉴权密钥）', async () => {
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 48202,
      hostId: 'mobile-host',
      authSecret: 'embedded-secret',
    });

    const adapter = new TauriRuntimeAdapter();
    await adapter.getStatus();

    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).toContain('"authSecret":"embedded-secret"');
  });
});
