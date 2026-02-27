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
});
