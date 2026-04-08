import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStoragePort, QueryOptions, QueryResult } from '@/lib/environment/interfaces/storage.port';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';
import {
  setRuntimeExternalAddress,
  setRuntimeExternalAuthToken,
} from '@/config/runtime-target';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  RuntimeHostServiceImpl,
  type RuntimeHostMetadataPatch,
} from '@/lib/services/runtime-host.service';

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
    __resetRuntimeConfigCacheForTests();
    window.localStorage.clear();
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
    expect(hosts[0]?.trustState).toBe('manual_seed');
    expect(hosts[0]?.manualOverride).toBe('127.0.0.1:4077');
  });

  it('defaults trust metadata for manual host seeds（手工添加主机默认写入 trust 元数据）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-07T10:00:00.000Z'),
    });

    const created = await service.addHost({
      name: 'Phone Peer',
      host: '192.168.1.88',
      port: 1949,
    });

    expect(created.trustState).toBe('manual_seed');
    expect(created.manualOverride).toBe('192.168.1.88:1949');
    expect(created.hostId).toBeUndefined();
    expect(created.lastSuccessfulDialAddress).toBeUndefined();
    expect(created.advertisedListenAddress).toBeUndefined();
  });

  it('normalizes legacy records without trust metadata（旧记录读取时补默认 trust 字段）', async () => {
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'legacy-runtime-host',
      name: 'Legacy',
      host: '10.0.0.9',
      port: 4077,
      status: 'unknown',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const hosts = await service.listHosts();

    expect(hosts[0]).toEqual(expect.objectContaining({
      id: 'legacy-runtime-host',
      trustState: 'manual_seed',
      manualOverride: '10.0.0.9:4077',
    }));
  });

  it('promotes manual seed to confirmed peer after successful dial with host id（成功拨号后手工种子升级 confirmed）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-07T11:00:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Desktop Peer',
      host: '10.0.0.20',
      port: 1949,
    });

    const updated = await service.mergeHostMetadata(created.id, {
      hostId: 'host-desktop-1',
      lastSuccessfulDialAddress: '10.0.0.20:1949',
      advertisedListenAddress: '10.0.0.20:1949',
    });

    expect(updated.hostId).toBe('host-desktop-1');
    expect(updated.lastSuccessfulDialAddress).toBe('10.0.0.20:1949');
    expect(updated.advertisedListenAddress).toBe('10.0.0.20:1949');
    expect(updated.trustState).toBe('confirmed_peer');
  });

  it('persists verification result fields across service instances（验证结果字段应跨实例持久化）', async () => {
    const serviceA = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-30T08:00:00.000Z'),
    });
    const created = await serviceA.addHost({
      name: 'Verified Peer',
      host: '10.0.0.21',
      port: 1949,
    });

    const updated = await serviceA.mergeHostMetadata(created.id, {
      hostId: 'host-verified-1',
      lastSuccessfulDialAddress: '10.0.0.21:1949',
      advertisedListenAddress: '10.0.0.21:1949',
      verificationStatus: 'verified',
      lastVerifiedAt: '2026-03-30T08:00:00.000Z',
      lastVerificationTrigger: 'pairing_auto',
      localInitiatedRttMs: 42,
      peerInitiatedRttMs: 57,
      lastVerificationError: 'stale error should still persist',
    });

    expect(updated.verificationStatus).toBe('verified');
    expect(updated.lastVerifiedAt).toBe('2026-03-30T08:00:00.000Z');
    expect(updated.lastVerificationTrigger).toBe('pairing_auto');
    expect(updated.localInitiatedRttMs).toBe(42);
    expect(updated.peerInitiatedRttMs).toBe(57);
    expect(updated.lastVerificationError).toBe('stale error should still persist');

    const serviceB = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
    });
    const hosts = await serviceB.listHosts();

    expect(hosts[0]).toEqual(expect.objectContaining({
      id: created.id,
      trustState: 'confirmed_peer',
      verificationStatus: 'verified',
      lastVerifiedAt: '2026-03-30T08:00:00.000Z',
      lastVerificationTrigger: 'pairing_auto',
      localInitiatedRttMs: 42,
      peerInitiatedRttMs: 57,
      lastVerificationError: 'stale error should still persist',
    }));
  });

  it('preserves confirmed peer idle verification status when reading storage（confirmed_peer 的 idle 验证状态读取时不能被吞掉）', async () => {
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'confirmed-peer-idle',
      name: 'Trusted But Unverified',
      host: '10.0.0.55',
      port: 1949,
      status: 'online',
      createdAt: '2026-03-30T07:00:00.000Z',
      updatedAt: '2026-03-30T07:00:00.000Z',
      trustState: 'confirmed_peer',
      hostId: 'host-confirmed-idle',
      manualOverride: '10.0.0.55:1949',
      lastSuccessfulDialAddress: '10.0.0.55:1949',
      advertisedListenAddress: '10.0.0.55:1949',
      verificationStatus: 'idle',
      lastVerifiedAt: '2026-03-30T06:59:00.000Z',
      lastVerificationTrigger: 'manual_retry',
      localInitiatedRttMs: 18,
      peerInitiatedRttMs: 23,
      lastVerificationError: 'waiting for first proof',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const [host] = await service.listHosts();

    expect(host).toEqual(expect.objectContaining({
      id: 'confirmed-peer-idle',
      trustState: 'confirmed_peer',
      verificationStatus: 'idle',
      lastVerifiedAt: '2026-03-30T06:59:00.000Z',
      lastVerificationTrigger: 'manual_retry',
      localInitiatedRttMs: 18,
      peerInitiatedRttMs: 23,
      lastVerificationError: 'waiting for first proof',
    }));
  });

  it('scrubs legacy confirmed peer auth token without explicit provenance and persists migration（历史 confirmed peer 污染 token 读取时清洗并回写）', async () => {
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'confirmed-peer-legacy-token',
      name: 'Legacy Confirmed Peer',
      host: '192.168.1.55',
      port: 9124,
      status: 'online',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      trustState: 'confirmed_peer',
      hostId: 'peer-host-id',
      authToken: 'legacy-copied-token',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const [host] = await service.listHosts();
    const persisted = await storage.read<RuntimeHostRecord[]>('agent_runtime_hosts_v1');

    expect(host?.authToken).toBeUndefined();
    expect(host?.authTokenSource).toBeUndefined();
    expect(persisted?.[0]?.authToken).toBeUndefined();
    expect(persisted?.[0]?.authTokenSource).toBeUndefined();
  });

  it('scrubs legacy discovered candidate auth token without explicit provenance（历史 discovered candidate 污染 token 读取时清洗）', async () => {
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'discovered-peer-legacy-token',
      name: 'Legacy Discovered Peer',
      host: '192.168.1.56',
      port: 9124,
      status: 'online',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      trustState: 'discovered_candidate',
      hostId: 'discovered-host-id',
      authToken: 'legacy-copied-token',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const [host] = await service.listHosts();

    expect(host?.authToken).toBeUndefined();
    expect(host?.authTokenSource).toBeUndefined();
  });

  it('preserves manual seed auth token and annotates manual provenance（手工主机 token 保留并补 provenance）', async () => {
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'manual-seed-token',
      name: 'Manual Seed',
      host: '192.168.1.57',
      port: 9124,
      status: 'online',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      trustState: 'manual_seed',
      authToken: 'manual-control-token',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const [host] = await service.listHosts();
    const persisted = await storage.read<RuntimeHostRecord[]>('agent_runtime_hosts_v1');

    expect(host?.authToken).toBe('manual-control-token');
    expect(host?.authTokenSource).toBe('manual_seed');
    expect(persisted?.[0]?.authTokenSource).toBe('manual_seed');
  });

  it('preserves matching external target token for confirmed peer and annotates provenance（匹配 external target 的 confirmed peer token 保留）', async () => {
    setRuntimeExternalAddress('192.168.1.58:9124');
    setRuntimeExternalAuthToken('external-control-token');
    await storage.write('agent_runtime_hosts_v1', [{
      id: 'confirmed-peer-external-token',
      name: 'External Target Peer',
      host: '192.168.1.58',
      port: 9124,
      status: 'online',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      trustState: 'confirmed_peer',
      hostId: 'peer-host-external',
      authToken: 'external-control-token',
    }]);

    const service = new RuntimeHostServiceImpl({ storage, fetchImpl: vi.fn() });
    const [host] = await service.listHosts();
    const persisted = await storage.read<RuntimeHostRecord[]>('agent_runtime_hosts_v1');

    expect(host?.authToken).toBe('external-control-token');
    expect(host?.authTokenSource).toBe('external_target');
    expect(persisted?.[0]?.authTokenSource).toBe('external_target');
  });

  it('allows clearing verification fields with null patch（允许用 null 清空验证字段）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-30T09:00:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Clearable Peer',
      host: '10.0.0.88',
      port: 1949,
      verificationStatus: 'failed',
      lastVerifiedAt: '2026-03-30T08:59:00.000Z',
      lastVerificationTrigger: 'manual_retry',
      localInitiatedRttMs: 91,
      peerInitiatedRttMs: 73,
      lastVerificationError: 'stale verification error',
    });

    const cleared = await service.mergeHostMetadata(created.id, {
      verificationStatus: 'running',
      lastVerifiedAt: null,
      lastVerificationTrigger: null,
      localInitiatedRttMs: null,
      peerInitiatedRttMs: null,
      lastVerificationError: null,
    });

    expect(cleared.verificationStatus).toBe('running');
    expect(cleared.lastVerifiedAt).toBeUndefined();
    expect(cleared.lastVerificationTrigger).toBeUndefined();
    expect(cleared.localInitiatedRttMs).toBeUndefined();
    expect(cleared.peerInitiatedRttMs).toBeUndefined();
    expect(cleared.lastVerificationError).toBeUndefined();
  });

  it('does not auto-promote discovered candidate without manual save（候选节点不会自动升级 confirmed）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-07T11:30:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Discovered Candidate',
      host: '10.0.0.30',
      port: 1949,
      trustState: 'discovered_candidate',
      manualOverride: undefined,
    });

    const updated = await service.mergeHostMetadata(created.id, {
      hostId: 'host-candidate-1',
      lastSuccessfulDialAddress: '10.0.0.30:1949',
    });

    expect(updated.trustState).toBe('discovered_candidate');
    expect(updated.hostId).toBe('host-candidate-1');
    expect(updated.lastSuccessfulDialAddress).toBe('10.0.0.30:1949');
  });

  it('does not auto-promote discovered candidate even with adb-forward override（候选节点带 adb-forward 也不会自动升级 confirmed）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-07T11:35:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Discovered Android Candidate',
      host: '10.0.2.15',
      port: 9124,
      trustState: 'discovered_candidate',
      advertisedListenAddress: '10.0.2.15:9124',
      manualOverride: '127.0.0.1:39124',
    });

    const updated = await service.mergeHostMetadata(created.id, {
      hostId: 'host-android-1',
      lastSuccessfulDialAddress: '127.0.0.1:39124',
    });

    expect(updated.trustState).toBe('discovered_candidate');
    expect(updated.hostId).toBe('host-android-1');
    expect(updated.manualOverride).toBe('127.0.0.1:39124');
    expect(updated.lastSuccessfulDialAddress).toBe('127.0.0.1:39124');
  });

  it('updates persisted endpoint fields when peer address is refreshed（对端地址刷新时更新持久化 endpoint 字段）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-30T11:35:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Node rt-deskt (192.168.85.1:21753)',
      host: '192.168.85.1',
      port: 21753,
      trustState: 'discovered_candidate',
      hostId: 'rt-desktop',
      advertisedListenAddress: '192.168.85.1:21753',
    });

    const updated = await service.mergeHostMetadata(created.id, {
      hostId: 'rt-desktop',
      advertisedListenAddress: '192.168.101.5:21753',
      lastSuccessfulDialAddress: '192.168.101.5:21753',
      host: '192.168.101.5',
      port: 21753,
      name: 'Node rt-deskt (192.168.101.5:21753)',
    } as RuntimeHostMetadataPatch);

    expect(updated.host).toBe('192.168.101.5');
    expect(updated.port).toBe(21753);
    expect(updated.name).toBe('Node rt-deskt (192.168.101.5:21753)');
    expect(updated.advertisedListenAddress).toBe('192.168.101.5:21753');
    expect(updated.lastSuccessfulDialAddress).toBe('192.168.101.5:21753');
    expect(updated.trustState).toBe('discovered_candidate');
  });

  it('keeps confirmed peer host id stable when dial target drifts（confirmed peer 不应被静默改绑到新 host_id）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-03-07T12:00:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Trusted Peer',
      host: '10.0.0.40',
      port: 1949,
    });

    const confirmed = await service.mergeHostMetadata(created.id, {
      hostId: 'host-trusted-1',
      lastSuccessfulDialAddress: '10.0.0.40:1949',
      advertisedListenAddress: '10.0.0.40:1949',
    });
    const drifted = await service.mergeHostMetadata(created.id, {
      hostId: 'host-impostor-2',
      lastSuccessfulDialAddress: '10.0.0.99:1949',
    });

    expect(confirmed.trustState).toBe('confirmed_peer');
    expect(drifted.trustState).toBe('confirmed_peer');
    expect(drifted.hostId).toBe('host-trusted-1');
    expect(drifted.lastSuccessfulDialAddress).toBe('10.0.0.99:1949');
  });

  it('preserves explicit manual token after manual seed is promoted to confirmed peer（手工种子升级 confirmed 后仍保留显式 token）', async () => {
    const service = new RuntimeHostServiceImpl({
      storage,
      fetchImpl: vi.fn(),
      now: () => new Date('2026-04-08T10:00:00.000Z'),
    });
    const created = await service.addHost({
      name: 'Manual Control Peer',
      host: '192.168.1.59',
      port: 9124,
      authToken: 'manual-control-token',
    });

    const promoted = await service.mergeHostMetadata(created.id, {
      hostId: 'manual-control-peer-id',
      lastSuccessfulDialAddress: '192.168.1.59:9124',
      advertisedListenAddress: '192.168.1.59:9124',
    });

    expect(created.authToken).toBe('manual-control-token');
    expect(created.authTokenSource).toBe('manual_seed');
    expect(promoted.trustState).toBe('confirmed_peer');
    expect(promoted.authToken).toBe('manual-control-token');
    expect(promoted.authTokenSource).toBe('manual_seed');
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
