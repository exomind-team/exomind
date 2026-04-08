import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeAggregatorServiceImpl } from '@/lib/services/runtime-aggregator.service';

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

const localHost: RuntimeHostRecord = {
  id: 'runtime-host-local',
  name: 'Local Runtime',
  host: '127.0.0.1',
  port: 9124,
  status: 'online',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  trustState: 'manual_seed',
};

const tokenlessConfirmedPeer: RuntimeHostRecord = {
  id: 'runtime-host-peer',
  name: 'Peer Runtime',
  host: '192.168.1.20',
  port: 9124,
  status: 'online',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  trustState: 'confirmed_peer',
  hostId: 'peer-host-id',
};

describe('RuntimeAggregatorServiceImpl', () => {
  it('skips tokenless confirmed peers during aggregateAll to avoid protected polling 401s（聚合时跳过无控制面 token 的 confirmed peer）', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/agents')) {
        return createJsonResponse([
          {
            id: 'agent-local',
            name: 'Local Agent',
            description: 'local',
            status: 'available',
          },
        ]);
      }

      if (url.endsWith('/topology')) {
        return createJsonResponse({
          host_id: 'local-host-id',
          hostname: 'local-host',
          os: 'windows',
          arch: 'x86_64',
          uptime_secs: 42,
          version: '0.1.0',
          port: 9124,
          capabilities: {
            agent_kinds: [],
            api_providers: [],
          },
        });
      }

      throw new Error(`unexpected fetch url: ${url}`);
    });

    const service = new RuntimeAggregatorServiceImpl({
      hostService: {
        listHosts: vi.fn(async () => [localHost, tokenlessConfirmedPeer]),
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await service.aggregateAll();
    const requestedUrls = fetchImpl.mock.calls.map(([input]) => String(input));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toEqual(expect.arrayContaining([
      'http://127.0.0.1:9124/agents',
      'http://127.0.0.1:9124/topology',
    ]));
    expect(requestedUrls.some((url) => url.includes('192.168.1.20'))).toBe(false);
    expect(result.hosts).toHaveLength(2);
    expect(result.agents).toEqual([
      expect.objectContaining({
        id: 'agent-local',
        hostId: 'runtime-host-local',
      }),
    ]);
    expect(result.topologies.get('runtime-host-local')).toEqual(expect.objectContaining({
      host_id: 'local-host-id',
    }));
  });

  it('returns empty agents for tokenless confirmed peers without fetching（无控制面 token 的 confirmed peer 查询 agents 时直接返回空）', async () => {
    const fetchImpl = vi.fn();
    const service = new RuntimeAggregatorServiceImpl({
      hostService: {
        listHosts: vi.fn(async () => [tokenlessConfirmedPeer]),
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const agents = await service.getAgentsByHost('runtime-host-peer');

    expect(agents).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null topology for tokenless confirmed peers without fetching（无控制面 token 的 confirmed peer 查询 topology 时直接返回空）', async () => {
    const fetchImpl = vi.fn();
    const service = new RuntimeAggregatorServiceImpl({
      hostService: {
        listHosts: vi.fn(async () => [tokenlessConfirmedPeer]),
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const topology = await service.getTopologyByHost('runtime-host-peer');

    expect(topology).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still fetches confirmed peers when an explicit control token exists（显式控制面 token 仍允许 confirmed peer 控制面查询）', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer remote-control-token');
      return createJsonResponse([
        {
          id: 'peer-agent',
          name: 'Peer Agent',
          description: 'peer',
          status: 'available',
        },
      ]);
    });

    const service = new RuntimeAggregatorServiceImpl({
      hostService: {
        listHosts: vi.fn(async () => [{
          ...tokenlessConfirmedPeer,
          authToken: 'remote-control-token',
        }]),
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const agents = await service.getAgentsByHost('runtime-host-peer');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(agents).toEqual([
      expect.objectContaining({
        id: 'peer-agent',
        hostId: 'runtime-host-peer',
      }),
    ]);
  });
});
