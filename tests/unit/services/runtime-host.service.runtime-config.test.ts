import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import { RuntimeHostServiceImpl } from '@/lib/services/runtime-host.service';

describe('runtime host service runtime-config persistence（RuntimeHost 默认走 Runtime 配置存储）', () => {
  beforeEach(() => {
    __resetRuntimeConfigCacheForTests();
    window.localStorage.clear();
  });

  it('reads persisted hosts from runtime config cache by default', async () => {
    __primeRuntimeConfigForTests({
      agent_runtime_hosts_v1: JSON.stringify([
        {
          id: 'runtime-host-1',
          name: 'Desk RT',
          host: '192.168.1.23',
          port: 1949,
          status: 'online',
          createdAt: '2026-03-30T00:00:00.000Z',
          updatedAt: '2026-03-30T00:00:00.000Z',
          isLocal: false,
          trustState: 'manual_seed',
          manualOverride: '192.168.1.23:1949',
        },
      ]),
    });

    const service = new RuntimeHostServiceImpl({ fetchImpl: vi.fn() });
    const hosts = await service.listHosts();

    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.host).toBe('192.168.1.23');
    expect(hosts[0]?.port).toBe(1949);
  });
});
