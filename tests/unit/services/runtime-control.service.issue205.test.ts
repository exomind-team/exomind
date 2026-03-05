import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRuntimePort } from '@/lib/environment/interfaces/runtime.port';
import { RuntimeControlServiceImpl } from '@/lib/services/runtime-control.service';

function createMockRuntimePort(overrides: Partial<IRuntimePort> = {}): IRuntimePort {
  return {
    startRuntime: vi.fn().mockResolvedValue({
      running: true, host: '127.0.0.1', port: 4077, pid: 9527,
    }),
    stopRuntime: vi.fn().mockResolvedValue({
      running: false, host: '127.0.0.1', port: 4077,
    }),
    getStatus: vi.fn().mockResolvedValue({
      running: true, host: '127.0.0.1', port: 4077, pid: 9527,
    }),
    ...overrides,
  };
}

describe('runtime control service issue-205（Runtime 启停服务）', () => {
  it('delegates startRuntime to port（委托 port 启动运行时）', async () => {
    const port = createMockRuntimePort();
    const service = new RuntimeControlServiceImpl(port);
    const status = await service.startRuntime({ host: '127.0.0.1', port: 4077 });

    expect(port.startRuntime).toHaveBeenCalledWith({ host: '127.0.0.1', port: 4077 });
    expect(status.running).toBe(true);
    expect(status.pid).toBe(9527);
  });

  it('delegates stopRuntime and getStatus to port（委托 port 停止与查询状态）', async () => {
    const port = createMockRuntimePort();
    const service = new RuntimeControlServiceImpl(port);

    const runningStatus = await service.getStatus();
    const stoppedStatus = await service.stopRuntime();

    expect(port.getStatus).toHaveBeenCalled();
    expect(port.stopRuntime).toHaveBeenCalled();
    expect(runningStatus.running).toBe(true);
    expect(stoppedStatus.running).toBe(false);
  });

  it('works with non-tauri port implementation（兼容非 Tauri 实现）', async () => {
    const port = createMockRuntimePort({
      startRuntime: vi.fn().mockResolvedValue({
        running: false, host: '127.0.0.1', port: 4077, error: 'not supported',
      }),
      getStatus: vi.fn().mockResolvedValue({
        running: false, host: '127.0.0.1', port: 4077, error: 'not supported',
      }),
    });
    const service = new RuntimeControlServiceImpl(port);
    const status = await service.getStatus();

    expect(status.running).toBe(false);
    expect(status.error).toContain('not supported');
  });
});
