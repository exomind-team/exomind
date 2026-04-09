import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeManager, shouldAutoPollRuntimeHost } from '@/services/runtime-manager';

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

  it('persists local hostId from mixed topology when flat host_id is absent（本机 mixed topology 缺少 flat host_id 时仍持久化）', async () => {
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch: { hostId?: string; lastSuccessfulDialAddress?: string }) => ({
      ...HOST_A,
      hostId: patch.hostId,
      lastSuccessfulDialAddress: patch.lastSuccessfulDialAddress,
    }));
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
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
          hostname: 'local-flat-hostname',
          os: 'windows',
          arch: 'x86_64',
          uptime_secs: 100,
          version: '0.1.0',
          port: 1919,
          capabilities: {
            agent_kinds: ['api' as const],
            api_providers: ['openai' as const],
          },
          runtime_host: {
            host_id: 'runtime-host-live-201',
            hostname: 'local-runtime-host',
            os: 'windows',
            arch: 'x86_64',
            uptime_secs: 100,
            version: '0.1.0',
            port: 1919,
            capabilities: {
              agent_kinds: ['api' as const],
              api_providers: ['openai' as const],
            },
          },
          device: {
            id: 'runtime-host-live-201',
            name: 'Hope Desktop',
            kind: 'desktop' as const,
            primary_runtime_host_id: 'runtime-host-live-201',
          },
          device_components: [],
          device_links: [],
        },
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    await manager.refreshSnapshot();

    expect(mergeHostMetadata).toHaveBeenCalledWith('host-a', {
      hostId: 'runtime-host-live-201',
      lastSuccessfulDialAddress: '127.0.0.1:1919',
    });
  });

  it('does not auto-poll discovered candidates without auth token（未验证 discovered candidate 不自动轮询受保护接口）', async () => {
    const discoveredHost: RuntimeHostRecord = {
      ...HOST_B,
      trustState: 'discovered_candidate',
    };
    const hostService = {
      listHosts: vi.fn(async () => [discoveredHost]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(),
      getTopology: vi.fn(),
      getAllEnergy: vi.fn(),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(runtimeClient.getAgents).not.toHaveBeenCalled();
    expect(runtimeClient.getTopology).not.toHaveBeenCalled();
    expect(runtimeClient.getAllEnergy).not.toHaveBeenCalled();
    expect(snapshot.hosts[0]).toMatchObject({
      connectionState: 'error',
      error: 'Awaiting verification before protected polling',
      agents: [],
      topology: null,
    });
  });

  it('still auto-polls discovered candidates when auth token exists（带 token 的 discovered candidate 仍允许自动轮询）', () => {
    expect(shouldAutoPollRuntimeHost({
      ...HOST_B,
      trustState: 'discovered_candidate',
      authToken: 'paired-token',
    })).toBe(true);
    expect(shouldAutoPollRuntimeHost({
      ...HOST_B,
      trustState: 'discovered_candidate',
    })).toBe(false);
    expect(shouldAutoPollRuntimeHost({
      ...HOST_B,
      trustState: 'confirmed_peer',
    })).toBe(false);
    expect(shouldAutoPollRuntimeHost({
      ...HOST_B,
      trustState: 'confirmed_peer',
      authToken: 'control-plane-token',
    })).toBe(true);
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

  it('defaults host-only input to port 9124（仅输入 host 时默认端口 9124）', async () => {
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
      port: 9124,
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

  it('persists peer hostId from mixed topology when flat host_id is absent（peer mixed topology 缺少 flat host_id 时仍持久化）', async () => {
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch: { hostId?: string; lastSuccessfulDialAddress?: string }) => ({
      ...HOST_B,
      hostId: patch.hostId,
      lastSuccessfulDialAddress: patch.lastSuccessfulDialAddress,
    }));
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
          runtime_host: {
            host_id: 'host-b-runtime-nested',
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
          device: {
            id: 'host-b-runtime-nested',
            name: 'Peer B',
            kind: 'phone' as const,
            primary_runtime_host_id: 'host-b-runtime-nested',
          },
          device_components: [],
          device_links: [],
        },
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    await manager.refreshSnapshot();

    expect(mergeHostMetadata).toHaveBeenCalledWith('host-b', {
      hostId: 'host-b-runtime-nested',
      lastSuccessfulDialAddress: '192.168.1.22:2919',
    });
  });

  it('retries mesh sync for unchanged confirmed peer metadata（confirmed peer 元数据未变化时仍重试 mesh 配对）', async () => {
    const ensurePeerPair = vi.fn(async () => undefined);
    const confirmedHost: RuntimeHostRecord = {
      ...HOST_B,
      hostId: 'host-b-logic',
      trustState: 'confirmed_peer',
      authToken: 'control-plane-token',
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

  it('persists local hostId from nested-only topology（本机 nested-only topology 仍可持久化 hostId）', async () => {
    const mergeHostMetadata = vi.fn(async (_hostId: string, patch: { hostId?: string; lastSuccessfulDialAddress?: string }) => ({
      ...HOST_A,
      hostId: patch.hostId,
      lastSuccessfulDialAddress: patch.lastSuccessfulDialAddress,
    }));
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
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
          runtime_host: {
            host_id: 'runtime-host-live',
            hostname: 'local',
            os: 'windows',
            arch: 'x86_64',
            uptime_secs: 100,
            version: '0.3.6',
            port: 1919,
            capabilities: {
              agent_kinds: ['api'],
              api_providers: ['openai'],
            },
          },
          device: {
            id: 'runtime-host-live',
            name: 'Hope Desktop',
            kind: 'desktop',
            primary_runtime_host_id: 'runtime-host-live',
          },
          device_components: [],
          device_links: [],
        } as unknown,
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    await manager.refreshSnapshot();

    expect(mergeHostMetadata).toHaveBeenCalledWith('host-a', {
      hostId: 'runtime-host-live',
      lastSuccessfulDialAddress: '127.0.0.1:1919',
    });
  });

  it('does not protected-poll confirmed peers without control-plane auth token（已确认 peer 无控制面 token 时不应再发受保护轮询）', async () => {
    const confirmedHost: RuntimeHostRecord = {
      ...HOST_B,
      hostId: 'host-b-logic',
      trustState: 'confirmed_peer',
      verificationStatus: 'verified',
      lastSuccessfulDialAddress: '192.168.1.22:2919',
      manualOverride: '192.168.1.22:2919',
    };
    const hostService = {
      listHosts: vi.fn(async () => [confirmedHost]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(),
      getTopology: vi.fn(),
      getAllEnergy: vi.fn(),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(runtimeClient.getAgents).not.toHaveBeenCalled();
    expect(runtimeClient.getTopology).not.toHaveBeenCalled();
    expect(runtimeClient.getAllEnergy).not.toHaveBeenCalled();
    expect(snapshot.hosts[0]).toMatchObject({
      connectionState: 'online',
      agents: [],
      topology: null,
    });
    expect(snapshot.hosts[0]?.error).toBeUndefined();
  });
});
