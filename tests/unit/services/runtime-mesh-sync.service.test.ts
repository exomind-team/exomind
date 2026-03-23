import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord, RuntimeServiceStatus } from '@/lib/types/agent-hub';
import { RuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';

const CONFIRMED_DESKTOP: RuntimeHostRecord = {
  id: 'runtime-host-desktop',
  name: 'Desktop',
  host: '192.168.1.10',
  port: 4077,
  status: 'online',
  createdAt: '2026-03-07T10:00:00.000Z',
  updatedAt: '2026-03-07T10:00:00.000Z',
  hostId: 'desktop-host',
  trustState: 'confirmed_peer',
  lastSuccessfulDialAddress: '192.168.1.10:4077',
  manualOverride: '192.168.1.10:4077',
};

const LOCAL_STATUS = {
  running: true,
  host: '127.0.0.1',
  port: 4077,
  hostId: 'mobile-host',
} as RuntimeServiceStatus & { hostId: string };

describe('runtime mesh sync service（Runtime Mesh 自动配对）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates reciprocal peers after confirmed host dial（confirmed host 后创建双向 peer）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    }));
    const service = new RuntimeMeshSyncService({
      fetchImpl,
      getLocalRuntimeStatus: vi.fn(async () => LOCAL_STATUS),
      getReachableAddress: vi.fn(async () => ({
        host: '192.168.1.20',
        port: 4077,
        hostId: 'mobile-host',
      })),
    });

    await service.ensurePeerPair(CONFIRMED_DESKTOP);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4077/mesh/peers', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        id: 'desktop-host',
        base_url: 'http://192.168.1.10:4077',
        enabled: true,
        capabilities: [],
      }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://192.168.1.10:4077/mesh/peers', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        id: 'mobile-host',
        base_url: 'http://192.168.1.20:4077',
        enabled: true,
        capabilities: [],
      }),
    }));
  });

  it('skips when host is not confirmed peer（未确认 peer 时跳过自动配对）', async () => {
    const fetchImpl = vi.fn();
    const service = new RuntimeMeshSyncService({
      fetchImpl,
      getLocalRuntimeStatus: vi.fn(async () => LOCAL_STATUS),
      getReachableAddress: vi.fn(),
    });

    await service.ensurePeerPair({
      ...CONFIRMED_DESKTOP,
      trustState: 'manual_seed',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still seeds local mesh peer when reciprocal address is unavailable（拿不到本机可达地址时也要先配置本地 mesh peer）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    }));
    const service = new RuntimeMeshSyncService({
      fetchImpl,
      getLocalRuntimeStatus: vi.fn(async () => LOCAL_STATUS),
      getReachableAddress: vi.fn(async () => null),
    });

    await service.ensurePeerPair(CONFIRMED_DESKTOP);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4077/mesh/peers', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        id: 'desktop-host',
        base_url: 'http://192.168.1.10:4077',
        enabled: true,
        capabilities: [],
      }),
    }));
  });

  it('surfaces initiate pairing diagnostics with status, auth state, and response body（发起配对失败时暴露状态码、鉴权状态和响应体）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'missing bearer token',
    }));
    const service = new RuntimeMeshSyncService({ fetchImpl });

    await expect(service.initiatePairing('http://127.0.0.1:4077', undefined)).rejects.toThrow(
      'initiatePairing failed: POST http://127.0.0.1:4077/mesh/pairing/initiate -> HTTP 401 Unauthorized, auth=missing, body=missing bearer token',
    );
  });
});
