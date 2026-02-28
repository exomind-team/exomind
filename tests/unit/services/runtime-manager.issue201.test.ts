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
});
