import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeMeshHostSyncService } from '@/lib/services/runtime-mesh-host-sync.service';

const EXISTING_HOSTS: RuntimeHostRecord[] = [];

describe('runtime mesh host sync service（mesh 状态映射到 host store）', () => {
  it('stores discovered peer as candidate and writes adb-forward dial override（发现节点时写入候选 host 与 adb-forward 拨号地址）', async () => {
    const addHost = vi.fn(async (input) => ({
      id: 'runtime-host-android',
      name: input.name ?? 'android',
      host: input.host,
      port: input.port ?? 9124,
      status: 'unknown' as const,
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
      hostId: input.hostId,
      trustState: input.trustState,
      advertisedListenAddress: input.advertisedListenAddress,
      manualOverride: input.manualOverride,
      authToken: input.authToken,
    }));
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => EXISTING_HOSTS),
        addHost,
        mergeHostMetadata: vi.fn(),
        removeHost: vi.fn(),
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => [{
          host_id: 'rt-android',
          host: '10.0.2.15',
          port: 9124,
        }]),
        listMeshPeers: vi.fn(async () => []),
        setPeerEnabled: vi.fn(async () => undefined),
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async () => ({
          host: '127.0.0.1',
          port: 39124,
        })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', 'shared-secret');

    expect(addHost).toHaveBeenCalledWith(expect.objectContaining({
      host: '10.0.2.15',
      port: 9124,
      hostId: 'rt-android',
      trustState: 'discovered_candidate',
      advertisedListenAddress: '10.0.2.15:9124',
      manualOverride: '127.0.0.1:39124',
      authToken: 'shared-secret',
    }));
    expect(hosts[0]).toEqual(expect.objectContaining({
      trustState: 'discovered_candidate',
      manualOverride: '127.0.0.1:39124',
    }));
  });

  it('promotes paired mesh peer to confirmed host metadata（mesh peer 时升级为 confirmed host 元数据）', async () => {
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch) => ({
      id: 'runtime-host-desktop',
      name: 'Desktop Node',
      host: '192.168.1.20',
      port: 9124,
      status: 'unknown' as const,
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
      hostId: patch.hostId,
      trustState: patch.trustState,
      advertisedListenAddress: patch.advertisedListenAddress,
      manualOverride: patch.manualOverride,
      authToken: patch.authToken,
    }));
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [{
          id: 'runtime-host-desktop',
          name: 'Desktop Node',
          host: '192.168.1.20',
          port: 9124,
          status: 'unknown',
          createdAt: '2026-03-30T10:00:00.000Z',
          updatedAt: '2026-03-30T10:00:00.000Z',
          hostId: 'rt-desktop',
          trustState: 'discovered_candidate',
        } satisfies RuntimeHostRecord]),
        addHost: vi.fn(),
        mergeHostMetadata,
        removeHost: vi.fn(),
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => []),
        listMeshPeers: vi.fn(async () => [{
          id: 'rt-desktop',
          base_url: 'http://192.168.1.20:9124',
          enabled: true,
        }]),
        setPeerEnabled: vi.fn(async () => undefined),
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async () => ({
          host: '192.168.1.20',
          port: 9124,
        })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', 'shared-secret');

    expect(mergeHostMetadata).toHaveBeenCalledWith(
      'runtime-host-desktop',
      expect.objectContaining({
        hostId: 'rt-desktop',
        trustState: 'confirmed_peer',
        advertisedListenAddress: '192.168.1.20:9124',
        manualOverride: undefined,
        authToken: 'shared-secret',
      }),
    );
    expect(hosts[0]).toEqual(expect.objectContaining({
      trustState: 'confirmed_peer',
      authToken: 'shared-secret',
    }));
  });

  it('keeps discovered node separate when endpoint is reused by a stale confirmed peer（同 endpoint 复用但 host_id 已变化时保留新发现节点）', async () => {
    const addHost = vi.fn(async (input) => ({
      id: 'runtime-host-current-android',
      name: input.name ?? 'current android',
      host: input.host,
      port: input.port ?? 9124,
      status: 'unknown' as const,
      createdAt: '2026-03-30T10:05:00.000Z',
      updatedAt: '2026-03-30T10:05:00.000Z',
      hostId: input.hostId,
      trustState: input.trustState,
      advertisedListenAddress: input.advertisedListenAddress,
      manualOverride: input.manualOverride,
      authToken: input.authToken,
    }));
    const mergeHostMetadata = vi.fn();
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [{
          id: 'runtime-host-stale-android',
          name: 'Old Android',
          host: '10.0.2.15',
          port: 9124,
          status: 'unknown',
          createdAt: '2026-03-30T09:00:00.000Z',
          updatedAt: '2026-03-30T09:00:00.000Z',
          hostId: 'rt-android-old',
          trustState: 'confirmed_peer',
          advertisedListenAddress: '127.0.0.1:39124',
          lastSuccessfulDialAddress: '127.0.0.1:39124',
        } satisfies RuntimeHostRecord]),
        addHost,
        mergeHostMetadata,
        removeHost: vi.fn(),
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => [{
          host_id: 'rt-android-current',
          host: '10.0.2.15',
          port: 9124,
        }]),
        listMeshPeers: vi.fn(async () => []),
        setPeerEnabled: vi.fn(async () => undefined),
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async () => ({
          host: '127.0.0.1',
          port: 39124,
        })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', 'shared-secret');

    expect(mergeHostMetadata).not.toHaveBeenCalled();
    expect(addHost).toHaveBeenCalledWith(expect.objectContaining({
      host: '10.0.2.15',
      port: 9124,
      hostId: 'rt-android-current',
      trustState: 'discovered_candidate',
      manualOverride: '127.0.0.1:39124',
    }));
    expect(hosts).toHaveLength(2);
    expect(hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'runtime-host-stale-android',
        trustState: 'confirmed_peer',
        hostId: 'rt-android-old',
      }),
      expect.objectContaining({
        id: 'runtime-host-current-android',
        trustState: 'discovered_candidate',
        hostId: 'rt-android-current',
      }),
    ]));
  });

  it('coalesces overlapping sync runs to avoid duplicate discovered hosts（并发同步时不重复写入同一候选节点）', async () => {
    const addHost = vi.fn(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        id: 'runtime-host-overlap-android',
        name: input.name ?? 'android',
        host: input.host,
        port: input.port ?? 9124,
        status: 'unknown' as const,
        createdAt: '2026-03-30T10:10:00.000Z',
        updatedAt: '2026-03-30T10:10:00.000Z',
        hostId: input.hostId,
        trustState: input.trustState,
        advertisedListenAddress: input.advertisedListenAddress,
        manualOverride: input.manualOverride,
        authToken: input.authToken,
      };
    });
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => EXISTING_HOSTS),
        addHost,
        mergeHostMetadata: vi.fn(),
        removeHost: vi.fn(),
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => [{
          host_id: 'rt-overlap-android',
          host: '10.0.2.15',
          port: 9124,
        }]),
        listMeshPeers: vi.fn(async () => []),
        setPeerEnabled: vi.fn(async () => undefined),
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async () => ({
          host: '127.0.0.1',
          port: 39124,
        })),
      },
    });

    const [first, second] = await Promise.all([
      service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', 'shared-secret'),
      service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', 'shared-secret'),
    ]);

    expect(addHost).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toEqual(expect.objectContaining({
      trustState: 'discovered_candidate',
      hostId: 'rt-overlap-android',
    }));
  });

  it('removes stale discovered hosts but keeps confirmed peers across runtime restarts（运行时重启时移除候选节点但保留已确认 peer）', async () => {
    const removeHost = vi.fn(async () => undefined);
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [
          {
            id: 'runtime-host-stale-candidate',
            name: 'Old Candidate',
            host: '10.0.0.8',
            port: 1949,
            status: 'unknown',
            createdAt: '2026-03-30T10:00:00.000Z',
            updatedAt: '2026-03-30T10:00:00.000Z',
            hostId: 'old-candidate',
            trustState: 'discovered_candidate',
          } satisfies RuntimeHostRecord,
          {
            id: 'runtime-host-stale-confirmed',
            name: 'Old Desktop',
            host: '10.0.2.2',
            port: 1949,
            status: 'unknown',
            createdAt: '2026-03-30T10:00:00.000Z',
            updatedAt: '2026-03-30T10:00:00.000Z',
            hostId: 'old-desktop',
            trustState: 'confirmed_peer',
          } satisfies RuntimeHostRecord,
        ]),
        addHost: vi.fn(),
        mergeHostMetadata: vi.fn(),
        removeHost,
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => []),
        listMeshPeers: vi.fn(async () => []),
        setPeerEnabled: vi.fn(async () => undefined),
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:31308', undefined);

    expect(removeHost).toHaveBeenCalledTimes(1);
    expect(removeHost).toHaveBeenCalledWith('runtime-host-stale-candidate');
    expect(hosts).toEqual([
      expect.objectContaining({
        id: 'runtime-host-stale-confirmed',
        trustState: 'confirmed_peer',
        hostId: 'old-desktop',
      }),
    ]);
  });

  it('disables duplicate mesh peers with the same base_url and removes stale confirmed host mirrors（相同 base_url 的重复 peer 会禁用旧记录并移除镜像 host）', async () => {
    const removeHost = vi.fn(async () => undefined);
    const setPeerEnabled = vi.fn(async () => undefined);
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch) => ({
      id: 'runtime-host-android-current',
      name: 'Android Current',
      host: '127.0.0.1',
      port: 39124,
      status: 'online' as const,
      createdAt: '2026-03-30T15:00:00.000Z',
      updatedAt: '2026-03-30T15:00:00.000Z',
      hostId: patch.hostId,
      trustState: patch.trustState,
      advertisedListenAddress: patch.advertisedListenAddress,
      manualOverride: patch.manualOverride,
      authToken: patch.authToken,
    }));
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [
          {
            id: 'runtime-host-android-current',
            name: 'Android Current',
            host: '127.0.0.1',
            port: 39124,
            status: 'online',
            createdAt: '2026-03-30T15:00:00.000Z',
            updatedAt: '2026-03-30T15:00:00.000Z',
            hostId: 'rt-android-current',
            trustState: 'confirmed_peer',
            manualOverride: '127.0.0.1:39124',
          } satisfies RuntimeHostRecord,
          {
            id: 'runtime-host-android-stale',
            name: 'Android Stale',
            host: '127.0.0.1',
            port: 39124,
            status: 'online',
            createdAt: '2026-03-30T14:55:00.000Z',
            updatedAt: '2026-03-30T14:55:00.000Z',
            hostId: 'rt-android-stale',
            trustState: 'confirmed_peer',
            manualOverride: '127.0.0.1:39124',
          } satisfies RuntimeHostRecord,
        ]),
        addHost: vi.fn(),
        mergeHostMetadata,
        removeHost,
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => []),
        listMeshPeers: vi.fn(async () => [
          {
            id: 'rt-android-current',
            base_url: 'http://127.0.0.1:39124',
            enabled: true,
            status: 'online',
            updated_at: '2026-03-30T15:01:00.000Z',
          },
          {
            id: 'rt-android-stale',
            base_url: 'http://127.0.0.1:39124',
            enabled: true,
            status: 'online',
            updated_at: '2026-03-30T14:56:00.000Z',
          },
        ]),
        setPeerEnabled,
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async () => ({
          host: '127.0.0.1',
          port: 39124,
        })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:64794', 'shared-secret');

    expect(setPeerEnabled).toHaveBeenCalledWith(
      'http://127.0.0.1:64794',
      'rt-android-stale',
      'http://127.0.0.1:39124',
      false,
      'shared-secret',
    );
    expect(removeHost).toHaveBeenCalledWith('runtime-host-android-stale');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toEqual(expect.objectContaining({
      id: 'runtime-host-android-current',
      hostId: 'rt-android-current',
      trustState: 'confirmed_peer',
    }));
  });

  it('disables stale bridge-alias peers when an online peer exists on the same bridge host（桥接别名 host 上已有在线 peer 时禁用旧异常 peer）', async () => {
    const removeHost = vi.fn(async () => undefined);
    const setPeerEnabled = vi.fn(async () => undefined);
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch) => ({
      id: 'runtime-host-desktop-current',
      name: 'Desktop Current',
      host: '198.18.0.1',
      port: 64794,
      status: 'online' as const,
      createdAt: '2026-03-30T15:02:00.000Z',
      updatedAt: '2026-03-30T15:02:00.000Z',
      hostId: patch.hostId,
      trustState: patch.trustState,
      advertisedListenAddress: patch.advertisedListenAddress,
      manualOverride: patch.manualOverride,
      authToken: patch.authToken,
    }));
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [
          {
            id: 'runtime-host-desktop-current',
            name: 'Desktop Current',
            host: '198.18.0.1',
            port: 64794,
            status: 'online',
            createdAt: '2026-03-30T15:02:00.000Z',
            updatedAt: '2026-03-30T15:02:00.000Z',
            hostId: 'rt-desktop-current',
            trustState: 'confirmed_peer',
            manualOverride: '198.18.0.1:64794',
          } satisfies RuntimeHostRecord,
          {
            id: 'runtime-host-desktop-stale',
            name: 'Desktop Stale',
            host: '198.18.0.1',
            port: 19807,
            status: 'offline',
            createdAt: '2026-03-30T14:59:00.000Z',
            updatedAt: '2026-03-30T14:59:00.000Z',
            hostId: 'rt-desktop-stale',
            trustState: 'confirmed_peer',
            manualOverride: '198.18.0.1:19807',
          } satisfies RuntimeHostRecord,
        ]),
        addHost: vi.fn(),
        mergeHostMetadata,
        removeHost,
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => []),
        listMeshPeers: vi.fn(async () => [
          {
            id: 'rt-desktop-current',
            base_url: 'http://198.18.0.1:64794',
            enabled: true,
            status: 'online',
            updated_at: '2026-03-30T15:02:30.000Z',
          },
          {
            id: 'rt-desktop-stale',
            base_url: 'http://198.18.0.1:19807',
            enabled: true,
            status: 'error',
            updated_at: '2026-03-30T15:01:00.000Z',
          },
        ]),
        setPeerEnabled,
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async (host: string, port: number) => ({ host, port })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:39124', 'shared-secret');

    expect(setPeerEnabled).toHaveBeenCalledWith(
      'http://127.0.0.1:39124',
      'rt-desktop-stale',
      'http://198.18.0.1:19807',
      false,
      'shared-secret',
    );
    expect(removeHost).toHaveBeenCalledWith('runtime-host-desktop-stale');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toEqual(expect.objectContaining({
      id: 'runtime-host-desktop-current',
      hostId: 'rt-desktop-current',
      trustState: 'confirmed_peer',
    }));
  });

  it('transfers verification metadata from a collapsed duplicate peer to the kept peer（折叠重复 peer 时迁移验证元数据）', async () => {
    const removeHost = vi.fn(async () => undefined);
    const setPeerEnabled = vi.fn(async () => undefined);
    const mergeHostMetadata = vi.fn(async (hostId: string, patch) => {
      if (hostId === 'runtime-host-desktop-current') {
        return {
          id: 'runtime-host-desktop-current',
          name: 'Desktop Current',
          host: '198.18.0.1',
          port: 64794,
          status: 'online' as const,
          createdAt: '2026-03-30T15:02:00.000Z',
          updatedAt: '2026-03-30T15:02:00.000Z',
          hostId: patch.hostId ?? 'rt-desktop-current',
          trustState: patch.trustState ?? 'confirmed_peer',
          advertisedListenAddress: patch.advertisedListenAddress,
          manualOverride: patch.manualOverride,
          authToken: patch.authToken,
          verificationStatus: patch.verificationStatus,
          lastVerifiedAt: patch.lastVerifiedAt ?? undefined,
          lastVerificationTrigger: patch.lastVerificationTrigger ?? undefined,
          localInitiatedRttMs: patch.localInitiatedRttMs ?? undefined,
          peerInitiatedRttMs: patch.peerInitiatedRttMs ?? undefined,
          lastVerificationError: patch.lastVerificationError ?? undefined,
        } satisfies RuntimeHostRecord;
      }

      return {
        id: 'runtime-host-desktop-current',
        name: 'Desktop Current',
        host: '198.18.0.1',
        port: 64794,
        status: 'online' as const,
        createdAt: '2026-03-30T15:02:00.000Z',
        updatedAt: '2026-03-30T15:02:00.000Z',
        hostId: patch.hostId,
        trustState: patch.trustState,
        advertisedListenAddress: patch.advertisedListenAddress,
        manualOverride: patch.manualOverride,
        authToken: patch.authToken,
      } satisfies RuntimeHostRecord;
    });
    const service = new RuntimeMeshHostSyncService({
      hostService: {
        listHosts: vi.fn(async () => [
          {
            id: 'runtime-host-desktop-current',
            name: 'Desktop Current',
            host: '198.18.0.1',
            port: 64794,
            status: 'online',
            createdAt: '2026-03-30T15:02:00.000Z',
            updatedAt: '2026-03-30T15:02:00.000Z',
            hostId: 'rt-desktop-current',
            trustState: 'confirmed_peer',
            manualOverride: '198.18.0.1:64794',
          } satisfies RuntimeHostRecord,
          {
            id: 'runtime-host-desktop-verified-stale',
            name: 'Desktop Verified Stale',
            host: '198.18.0.1',
            port: 64794,
            status: 'online',
            createdAt: '2026-03-30T14:58:00.000Z',
            updatedAt: '2026-03-30T14:58:00.000Z',
            hostId: 'rt-desktop-verified-stale',
            trustState: 'confirmed_peer',
            manualOverride: '198.18.0.1:64794',
            verificationStatus: 'verified',
            lastVerifiedAt: '2026-03-30T15:01:16.000Z',
            lastVerificationTrigger: 'manual_retry',
            localInitiatedRttMs: 281,
            peerInitiatedRttMs: 0,
          } satisfies RuntimeHostRecord,
        ]),
        addHost: vi.fn(),
        mergeHostMetadata,
        removeHost,
      },
      meshService: {
        listDiscoveredPeers: vi.fn(async () => []),
        listMeshPeers: vi.fn(async () => [
          {
            id: 'rt-desktop-current',
            base_url: 'http://198.18.0.1:64794',
            enabled: true,
            status: 'online',
            updated_at: '2026-03-30T15:02:30.000Z',
          },
          {
            id: 'rt-desktop-verified-stale',
            base_url: 'http://198.18.0.1:64794',
            enabled: true,
            status: 'online',
            updated_at: '2026-03-30T15:02:00.000Z',
          },
        ]),
        setPeerEnabled,
      },
      runtimeControlService: {
        getPeerDialAddress: vi.fn(async (host: string, port: number) => ({ host, port })),
      },
    });

    const hosts = await service.syncLocalRuntimeMeshState('http://127.0.0.1:39124', 'shared-secret');

    expect(setPeerEnabled).toHaveBeenCalledWith(
      'http://127.0.0.1:39124',
      'rt-desktop-verified-stale',
      'http://198.18.0.1:64794',
      false,
      'shared-secret',
    );
    expect(mergeHostMetadata).toHaveBeenCalledWith(
      'runtime-host-desktop-current',
      expect.objectContaining({
        verificationStatus: 'verified',
        lastVerifiedAt: '2026-03-30T15:01:16.000Z',
        lastVerificationTrigger: 'manual_retry',
        localInitiatedRttMs: 281,
        peerInitiatedRttMs: 0,
      }),
    );
    expect(removeHost).toHaveBeenCalledWith('runtime-host-desktop-verified-stale');
    expect(hosts[0]).toEqual(expect.objectContaining({
      id: 'runtime-host-desktop-current',
      verificationStatus: 'verified',
      lastVerifiedAt: '2026-03-30T15:01:16.000Z',
      localInitiatedRttMs: 281,
      peerInitiatedRttMs: 0,
    }));
  });
});
