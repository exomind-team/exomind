import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
}));

import { RuntimeControlServiceImpl } from '@/lib/services/runtime-control.service';

describe('runtime control service issue-205（Runtime 启停服务）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls tauri start command with host and port（调用 tauri 启动命令）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 4077,
      pid: 9527,
    });

    const service = new RuntimeControlServiceImpl();
    const status = await service.startRuntime({
      host: '127.0.0.1',
      port: 4077,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('runtime_service_start', {
      host: '127.0.0.1',
      port: 4077,
    });
    expect(status.running).toBe(true);
    expect(status.pid).toBe(9527);
  });

  it('calls tauri stop/status commands（调用 tauri 停止与状态命令）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'runtime_service_stop') {
        return { running: false, host: '127.0.0.1', port: 4077 };
      }
      return { running: true, host: '127.0.0.1', port: 4077, pid: 9527 };
    });

    const service = new RuntimeControlServiceImpl();
    const runningStatus = await service.getStatus();
    const stoppedStatus = await service.stopRuntime();

    expect(tauriMocks.invoke).toHaveBeenCalledWith('runtime_service_status');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('runtime_service_stop');
    expect(runningStatus.running).toBe(true);
    expect(stoppedStatus.running).toBe(false);
  });

  it('returns offline status in non-tauri runtime（非 tauri 环境返回离线状态）', async () => {
    tauriMocks.isTauri.mockResolvedValue(false);

    const service = new RuntimeControlServiceImpl();
    const status = await service.getStatus();

    expect(status.running).toBe(false);
    expect(status.error).toContain('tauri');
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });
});
