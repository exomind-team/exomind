import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeManager } from '@/services/runtime-manager';

const HOST_A: RuntimeHostRecord = {
  id: 'host-a',
  name: 'Host A',
  host: '127.0.0.1',
  port: 1919,
  status: 'unknown',
  createdAt: '2026-03-07T00:00:00.000Z',
  updatedAt: '2026-03-07T00:00:00.000Z',
};

describe('runtime manager issue-385（运行时能力快照）', () => {
  it('keeps runtime capabilities on host snapshots（主机快照保留运行时能力）', async () => {
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
    };
    const runtimeClient = {
      getAgents: vi.fn(async () => ({
        ok: true as const,
        data: [],
      })),
      getTopology: vi.fn(async () => ({
        ok: true as const,
        data: {
          host_id: 'runtime-host-1',
          hostname: 'local-dev',
          os: 'windows',
          arch: 'x86_64',
          uptime_secs: 100,
          version: '0.3.6',
          port: 1919,
          total_memory_mb: 16000,
          used_memory_mb: 8000,
          capabilities: {
            agent_kinds: ['codex_cli', 'api'] as const,
            api_providers: ['openai', 'anthropic'] as const,
          },
        },
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.hosts[0]?.topology?.capabilities.agent_kinds).toEqual(['codex_cli', 'api']);
    expect(snapshot.hosts[0]?.topology?.capabilities.api_providers).toEqual(['openai', 'anthropic']);
  });

  it('keeps capabilities from topology.runtime_host.capabilities（从 runtime_host.capabilities 保留能力快照）', async () => {
    const hostService = {
      listHosts: vi.fn(async () => [HOST_A]),
      addHost: vi.fn(),
      removeHost: vi.fn(),
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
            host_id: 'runtime-host-1',
            hostname: 'local-dev',
            os: 'windows',
            arch: 'x86_64',
            uptime_secs: 100,
            version: '0.3.6',
            port: 1919,
            total_memory_mb: 16000,
            used_memory_mb: 8000,
            capabilities: {
              agent_kinds: ['claude_cli', 'api'] as const,
              api_providers: ['openai', 'anthropic'] as const,
            },
          },
          device: {
            id: 'runtime-host-1',
            name: 'Hope Desktop',
            kind: 'desktop',
            primary_runtime_host_id: 'runtime-host-1',
          },
          device_components: [],
          device_links: [],
        } as unknown,
      })),
    };

    const manager = new RuntimeManager({ hostService, runtimeClient });
    const snapshot = await manager.refreshSnapshot();

    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.hosts[0]?.topology?.capabilities.agent_kinds).toEqual(['claude_cli', 'api']);
    expect(snapshot.hosts[0]?.topology?.capabilities.api_providers).toEqual(['openai', 'anthropic']);
    expect((snapshot.hosts[0]?.topology as { runtime_host?: { capabilities?: { agent_kinds?: string[] } } } | null)?.runtime_host?.capabilities?.agent_kinds)
      .toEqual(['claude_cli', 'api']);
  });
});
