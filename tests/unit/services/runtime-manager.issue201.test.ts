import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeManager } from '@/services/runtime-manager';

const HOST_A: RuntimeHostRecord = {
  id: 'host-a',
  name: 'Host A',
  host: '127.0.0.1',
  port: 1919,
  status: 'unknown',
  createdAt: '2026-02-28T00:00:00.000Z',
  updatedAt: '2026-02-28T00:00:00.000Z',
};

const HOST_B: RuntimeHostRecord = {
  id: 'host-b',
  name: 'Host B',
  host: '192.168.1.22',
  port: 2919,
  status: 'unknown',
  createdAt: '2026-02-28T00:00:00.000Z',
  updatedAt: '2026-02-28T00:00:00.000Z',
};

describe('runtime manager issue-201（多主机聚合管理）', () => {
  it('aggregates agents from multiple hosts with source labels（聚合多主机 agent 并标注来源）', async () => {
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A, HOST_B]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
      probeHost: vi.fn(),
      probeAllHosts: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(async (host: RuntimeHostRecord) => {
        if (host.id === 'host-a') {
          return {
            ok: true as const,
            data: [{ id: 'echo', name: 'Echo Agent', description: 'ok', status: 'available' as const }],
          };
        }
        return {
          ok: true as const,
          data: [{ id: 'daily', name: 'Daily Agent', description: 'summary', status: 'busy' as const }],
        };
      }),
      getTopology: vi.fn(async () => ({
        ok: true as const,
        data: {
          hostname: 'local',
          os: 'windows',
          arch: 'x86_64',
          uptime_secs: 100,
          version: '0.1.0',
          port: 1919,
        },
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents[0]?.sourceHostName).toBeDefined();
    expect(snapshot.hosts.every((item) => item.connectionState === 'online')).toBe(true);
  });

  it('keeps offline host visible when request fails（请求失败时保留离线主机）', async () => {
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
      probeHost: vi.fn(),
      probeAllHosts: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'network' as const, message: 'ECONNREFUSED' },
      })),
      getTopology: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'network' as const, message: 'ECONNREFUSED' },
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(snapshot.agents).toHaveLength(0);
    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.hosts[0]?.connectionState).toBe('offline');
  });

  it('parses host:port and forwards to host service（解析 host:port 并调用 hostService）', async () => {
    const addHost = vi.fn(async () => HOST_A);
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost,
      removeHost: vi.fn(),
      probeHost: vi.fn(),
      probeAllHosts: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(),
      getTopology: vi.fn(),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    await manager.addHostFromAddress('10.1.2.3:4077', 'LAN Runtime');

    expect(addHost).toHaveBeenCalledWith({
      name: 'LAN Runtime',
      host: '10.1.2.3',
      port: 4077,
    });
  });

  it('defaults host-only input to port 1949（仅输入 host 时默认端口 1949）', async () => {
    const addHost = vi.fn(async () => HOST_A);
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost,
      removeHost: vi.fn(),
      probeHost: vi.fn(),
      probeAllHosts: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(),
      getTopology: vi.fn(),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    await manager.addHostFromAddress('10.1.2.3', 'LAN Runtime');

    expect(addHost).toHaveBeenCalledWith({
      name: 'LAN Runtime',
      host: '10.1.2.3',
      port: 1949,
    });
  });

  it('rejects full url input and requires plain host:port（拒绝完整 URL，仅接受 host:port）', async () => {
    const addHost = vi.fn(async () => HOST_A);
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost,
      removeHost: vi.fn(),
      probeHost: vi.fn(),
      probeAllHosts: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(),
      getTopology: vi.fn(),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });

    await expect(manager.addHostFromAddress('http://127.0.0.1:19424/health', 'Bad Input')).rejects.toThrow(
      'invalid host:port format',
    );
    expect(addHost).not.toHaveBeenCalled();
  });

  it('syncs mesh peer pair when host becomes confirmed peer（confirmed peer 后触发 mesh 自动配对）', async () => {
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch: { hostId?: string; lastSuccessfulDialAddress?: string }) => ({
      ...HOST_B,
      hostId: patch.hostId,
      lastSuccessfulDialAddress: patch.lastSuccessfulDialAddress,
      manualOverride: '192.168.1.22:2919',
      trustState: 'confirmed_peer' as const,
    }));
    const ensurePeerPair = vi.fn(async () => undefined);
    const hostService = {
      listHosts: vi.fn(async () => [HOST_B]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
      mergeHostMetadata,
    };
    const runtimeClient = {
      getAgents: vi.fn(async () => ({
        ok: true as const,
        data: [],
      })),
      getTopology: vi.fn(async () => ({
        ok: true as const,
        data: {
          host_id: 'host-b-logic',
          hostname: 'peer-b',
          os: 'android',
          arch: 'arm64',
          uptime_secs: 100,
          version: '0.3.6',
          port: 2919,
          capabilities: {
            agent_kinds: ['api' as const],
            api_providers: ['openai' as const, 'anthropic' as const],
          },
        },
      })),
    };

    const manager = new RuntimeManager({
      hostService,
      runtimeClient,
      runtimeMeshSyncService: { ensurePeerPair },
    });
    await manager.refreshSnapshot();

    expect(mergeHostMetadata).toHaveBeenCalled();
    expect(ensurePeerPair).toHaveBeenCalledWith(expect.objectContaining({
      id: 'host-b',
      trustState: 'confirmed_peer',
      hostId: 'host-b-logic',
    }));
  });

  it('retries mesh sync for unchanged confirmed peer metadata（confirmed peer 元数据未变化时仍重试 mesh 配对）', async () => {
    const ensurePeerPair = vi.fn(async () => undefined);
    const confirmedHost: RuntimeHostRecord = {
      ...HOST_B,
      hostId: 'host-b-logic',
      trustState: 'confirmed_peer',
      lastSuccessfulDialAddress: '192.168.1.22:2919',
      manualOverride: '192.168.1.22:2919',
    };
    const mergeHostMetadata = vi.fn(async () => confirmedHost);
    const hostService = {
      listHosts: vi.fn(async () => [confirmedHost]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
      mergeHostMetadata,
    };
    const runtimeClient = {
      getAgents: vi.fn(async () => ({
        ok: true as const,
        data: [],
      })),
      getTopology: vi.fn(async () => ({
        ok: true as const,
        data: {
          host_id: 'host-b-logic',
          hostname: 'peer-b',
          os: 'android',
          arch: 'arm64',
          uptime_secs: 100,
          version: '0.3.6',
          port: 2919,
          capabilities: {
            agent_kinds: ['api' as const],
            api_providers: ['openai' as const, 'anthropic' as const],
          },
        },
      })),
    };

    const manager = new RuntimeManager({
      hostService,
      runtimeClient,
      runtimeMeshSyncService: { ensurePeerPair },
    });
    await manager.refreshSnapshot();

    expect(mergeHostMetadata).not.toHaveBeenCalled();
    expect(ensurePeerPair).toHaveBeenCalledWith(expect.objectContaining({
      id: 'host-b',
      trustState: 'confirmed_peer',
      hostId: 'host-b-logic',
    }));
  });
});
