import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStoragePort, QueryOptions, QueryResult } from '@/lib/environment/interfaces/storage.port';
import { RuntimeHostServiceImpl } from '@/lib/services/runtime-host.service';

class InMemoryStorageAdapter implements IStoragePort {
  private readonly memory = new Map<string, unknown>();

  async write<T>(key: string, data: T): Promise<void> {
    this.memory.set(key, structuredClone(data));
  }

  async read<T>(key: string): Promise<T | null> {
    if (!this.memory.has(key)) return null;
    return structuredClone(this.memory.get(key) as T);
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
  }

  async readAll<T>(): Promise<Map<string, T>> {
    return new Map(Array.from(this.memory.entries()).map(([key, value]) => [key, structuredClone(value as T)]));
  }

  async clear(): Promise<void> {
    this.memory.clear();
  }

  async query<T>(_options: QueryOptions<T>): Promise<QueryResult<T>> {
    return {
      items: [],
      total: 0,
      hasMore: false,
    };
  }
}

describe('runtime host service issue-205（RuntimeHost 服务）', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('adds runtime host and persists across service instances（新增主机并跨实例持久化）', async () => {
    const serviceA = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
    });

    const created = await serviceA.addHost({
      name: 'Hope Desktop',
      host: '127.0.0.1',
      port: 4077,
    });

    expect(created.id).toMatch(/^runtime-host-/);
    expect(created.status).toBe('unknown');

    const serviceB = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
    });
    const hosts = await serviceB.listHosts();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.name).toBe('Hope Desktop');
    expect(hosts[0]?.host).toBe('127.0.0.1');
    expect(hosts[0]?.port).toBe(4077);
  });

  it('marks host online when probe succeeds（探测成功后标记在线）', async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
      };
    });
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl, now: () => new Date('2026-02-27T10:00:00.000Z') });
    const host = await service.addHost({
      name: 'LAN Runtime',
      host: '192.168.50.12',
      port: 8877,
    });

    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('online');
    expect(probed.lastCheckedAt).toBe('2026-02-27T10:00:00.000Z');
    expect(probed.lastError).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith('http://192.168.50.12:8877/health', expect.any(Object));
  });

  it('marks host offline when probe throws（探测异常后标记离线）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T10:10:00.000Z'),
    });
    const host = await service.addHost({
      name: 'Edge Device',
      host: '10.0.0.56',
      port: 9001,
    });

    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('offline');
    expect(probed.lastError).toContain('ECONNREFUSED');
    expect(probed.lastCheckedAt).toBe('2026-02-27T10:10:00.000Z');
  });

  it('maps aborted signal error to timeout hint（中止信号错误映射为超时提示）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('signal is aborted without reason');
    });
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T10:20:00.000Z'),
    });
    const host = await service.addHost({
      name: 'Timeout Runtime',
      host: '192.168.1.99',
      port: 4077,
    });

    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('offline');
    expect(probed.lastError).toContain('probe timeout（探测超时）');
    expect(probed.lastCheckedAt).toBe('2026-02-27T10:20:00.000Z');
  });

  // --- P0-2: listHosts ---

  it('returns empty array when no hosts exist（无主机时返回空数组）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const hosts = await service.listHosts();
    expect(hosts).toEqual([]);
  });

  it('returns all persisted hosts（返回所有已持久化的主机）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    await service.addHost({ name: 'Host A', host: '10.0.0.1', port: 4077 });
    await service.addHost({ name: 'Host B', host: '10.0.0.2', port: 4078 });
    const hosts = await service.listHosts();
    expect(hosts).toHaveLength(2);
    expect(hosts[0]?.name).toBe('Host A');
    expect(hosts[1]?.name).toBe('Host B');
  });

  // --- P0-2: removeHost ---

  it('removes host by id（按 ID 删除主机）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const host = await service.addHost({ name: 'To Remove', host: '10.0.0.3', port: 5000 });
    await service.removeHost(host.id);
    const hosts = await service.listHosts();
    expect(hosts).toHaveLength(0);
  });

  it('does not throw when removing non-existent host（删除不存在的主机不抛异常）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    await expect(service.removeHost('non-existent-id')).resolves.toBeUndefined();
  });

  it('only removes the target host, keeps others（只删除目标主机，保留其他）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const hostA = await service.addHost({ name: 'Keep', host: '10.0.0.1', port: 4077 });
    const hostB = await service.addHost({ name: 'Remove', host: '10.0.0.2', port: 4078 });
    await service.removeHost(hostB.id);
    const hosts = await service.listHosts();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.id).toBe(hostA.id);
  });

  // --- P0-2: probeAllHosts ---

  it('probes all hosts and updates status（探测所有主机并更新状态）', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: true, status: 200 };
      throw new Error('ECONNREFUSED');
    });
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T12:00:00.000Z'),
    });
    await service.addHost({ name: 'Online', host: '10.0.0.1', port: 4077 });
    await service.addHost({ name: 'Offline', host: '10.0.0.2', port: 4078 });

    const results = await service.probeAllHosts();
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('online');
    expect(results[1]?.status).toBe('offline');
    expect(results[1]?.lastError).toContain('ECONNREFUSED');
  });

  it('returns empty array when no hosts to probe（无主机时返回空数组）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const results = await service.probeAllHosts();
    expect(results).toEqual([]);
  });

  it('persists probed status for all hosts（持久化所有主机的探测状态）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T12:00:00.000Z'),
    });
    await service.addHost({ name: 'A', host: '10.0.0.1', port: 4077 });
    await service.probeAllHosts();

    // 用新实例验证持久化
    const service2 = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const hosts = await service2.listHosts();
    expect(hosts[0]?.status).toBe('online');
    expect(hosts[0]?.lastCheckedAt).toBe('2026-02-27T12:00:00.000Z');
  });

  // --- P1-5: HTTP 错误响应 ---

  it('marks host as warning when HTTP returns 5xx（HTTP 5xx 标记为 warning）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T13:00:00.000Z'),
    });
    const host = await service.addHost({ name: 'Server Error', host: '10.0.0.5', port: 4077 });
    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('warning');
    expect(probed.lastError).toBe('HTTP 500');
  });

  it('marks host as warning when HTTP returns 4xx（HTTP 4xx 标记为 warning）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T13:00:00.000Z'),
    });
    const host = await service.addHost({ name: 'Not Found', host: '10.0.0.6', port: 4077 });
    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('warning');
    expect(probed.lastError).toBe('HTTP 404');
  });

  // --- P1-5: probeHost 不存在的 host ---

  it('throws when probing non-existent host（探测不存在的主机时抛异常）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    await expect(service.probeHost('non-existent')).rejects.toThrow('runtime host not found');
  });

  // --- P1-5: addHost 验证 ---

  it('throws when port is invalid（端口无效时抛异常）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    await expect(service.addHost({ host: '10.0.0.1', port: 0 })).rejects.toThrow('port must be an integer between 1 and 65535');
    await expect(service.addHost({ host: '10.0.0.1', port: 70000 })).rejects.toThrow('port must be an integer between 1 and 65535');
    await expect(service.addHost({ host: '10.0.0.1', port: -1 })).rejects.toThrow('port must be an integer between 1 and 65535');
  });

  it('throws when host is empty（主机为空时抛异常）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    await expect(service.addHost({ host: '', port: 4077 })).rejects.toThrow('host is required');
    await expect(service.addHost({ host: '   ', port: 4077 })).rejects.toThrow('host is required');
  });

  it('uses host:port as default name when name is not provided（未提供名称时使用 host:port）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const host = await service.addHost({ host: '192.168.1.1', port: 8080 });
    expect(host.name).toBe('192.168.1.1:8080');
  });

  it('sets isLocal flag correctly（正确设置 isLocal 标志）', async () => {
    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const localHost = await service.addHost({ host: '127.0.0.1', port: 4077, isLocal: true });
    const remoteHost = await service.addHost({ host: '10.0.0.1', port: 4077 });
    expect(localHost.isLocal).toBe(true);
    expect(remoteHost.isLocal).toBe(false);
  });

  // --- P1-5: AbortError 变体 ---

  it('maps AbortError variant to timeout hint（AbortError 变体映射为超时提示）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('AbortError: The operation was aborted');
    });
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl,
      now: () => new Date('2026-02-27T14:00:00.000Z'),
    });
    const host = await service.addHost({ name: 'Abort Test', host: '10.0.0.7', port: 4077 });
    const probed = await service.probeHost(host.id);
    expect(probed.status).toBe('offline');
    expect(probed.lastError).toContain('probe timeout');
  });
});
