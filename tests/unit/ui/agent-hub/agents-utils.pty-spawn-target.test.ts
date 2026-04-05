import { describe, expect, it } from 'vitest';
import type { RuntimeTarget } from '@/config/runtime-target';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub';
import type { RuntimeHostSnapshot } from '@/services/runtime-manager';
import { resolvePtySpawnConnectionTarget } from '@/ui/app/pages/agents/agents-utils';

function buildSelectedTarget(overrides: Partial<RuntimeTarget> = {}): RuntimeTarget {
  return {
    mode: 'embedded',
    host: '127.0.0.1',
    port: 9124,
    authToken: 'local-selected-token',
    ...overrides,
  };
}

function buildRuntimeStatus(overrides: Partial<RuntimeServiceStatus> = {}): RuntimeServiceStatus {
  return {
    running: true,
    host: '127.0.0.1',
    port: 9124,
    hostId: 'local-runtime-host',
    ...overrides,
  };
}

function buildSnapshot(overrides: Partial<RuntimeHostSnapshot> = {}): RuntimeHostSnapshot {
  return {
    host: {
      id: 'snapshot-host',
      name: '127.0.0.1:9124',
      host: '127.0.0.1',
      port: 9124,
      status: 'online',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      ...overrides.host,
    },
    connectionState: 'online',
    agents: [],
    topology: {
      host_id: 'local-runtime-host',
      hostname: 'local-runtime-host',
      os: 'Windows 11',
      arch: 'x64',
      uptime_secs: 120,
      version: '0.3.6',
      port: 9124,
      capabilities: {
        agent_kinds: ['claude_cli', 'codex_cli', 'api'],
        api_providers: ['openai'],
      },
    },
    ...overrides,
  };
}

describe('resolvePtySpawnConnectionTarget', () => {
  it('prefers the selected runtime target snapshot over unrelated online route hosts', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget(),
      runtimeServiceStatus: buildRuntimeStatus(),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'remote-host',
            name: '192.168.1.48:9124',
            host: '192.168.1.48',
            port: 9124,
            authToken: 'remote-token',
          },
          topology: {
            host_id: 'remote-peer',
            hostname: 'remote-peer',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 120,
            version: '0.3.6',
            port: 9124,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli'],
              api_providers: ['openai'],
            },
          },
        }),
        buildSnapshot({
          host: {
            id: 'local-host',
            name: '127.0.0.1:9124',
            host: '127.0.0.1',
            port: 9124,
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://127.0.0.1:9124',
      authToken: 'local-selected-token',
      hostId: 'local-runtime-host',
    });
  });

  it('falls back to the running embedded runtime when no snapshot matches the selected target', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget(),
      runtimeServiceStatus: buildRuntimeStatus({
        host: '0.0.0.0',
        port: 1919,
        hostId: 'embedded-local-host',
      }),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'remote-host',
            name: '192.168.1.48:9124',
            host: '192.168.1.48',
            port: 9124,
            authToken: 'remote-token',
          },
          topology: {
            host_id: 'remote-peer',
            hostname: 'remote-peer',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 120,
            version: '0.3.6',
            port: 9124,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli'],
              api_providers: ['openai'],
            },
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://127.0.0.1:1919',
      authToken: 'local-selected-token',
      hostId: 'embedded-local-host',
    });
  });

  it('reuses the live snapshot peer id when the running embedded runtime matches by host:port but status has no hostId', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget({
        host: '127.0.0.1',
        port: 9124,
      }),
      runtimeServiceStatus: buildRuntimeStatus({
        host: '127.0.0.1',
        port: 1919,
        hostId: undefined,
      }),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'local-runtime-record',
            name: '127.0.0.1:1919',
            host: '127.0.0.1',
            port: 1919,
          },
          topology: {
            host_id: 'runtime-host-523',
            hostname: 'runtime-host-523',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 120,
            version: '0.3.6',
            port: 1919,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli'],
              api_providers: ['openai'],
            },
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://127.0.0.1:1919',
      authToken: 'local-selected-token',
      hostId: 'runtime-host-523',
    });
  });

  it('prefers the local loopback snapshot when the embedded runtime is represented by multiple addresses', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget(),
      runtimeServiceStatus: buildRuntimeStatus({
        host: '0.0.0.0',
        port: 9124,
        hostId: 'local-runtime-host',
      }),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'local-lan-host',
            name: '192.168.1.48:9124',
            host: '192.168.1.48',
            port: 9124,
          },
        }),
        buildSnapshot({
          host: {
            id: 'local-loopback-host',
            name: '127.0.0.1:9124',
            host: '127.0.0.1',
            port: 9124,
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://127.0.0.1:9124',
      authToken: 'local-selected-token',
      hostId: 'local-runtime-host',
    });
  });

  it('trusts the live embedded runtime hostId over a stale loopback snapshot after RT restart', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget(),
      runtimeServiceStatus: buildRuntimeStatus({
        host: '0.0.0.0',
        port: 9124,
        hostId: 'embedded-runtime-current',
      }),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'stale-loopback-host',
            name: '127.0.0.1:9124',
            host: '127.0.0.1',
            port: 9124,
          },
          topology: {
            host_id: 'embedded-runtime-stale',
            hostname: 'embedded-runtime-stale',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 120,
            version: '0.3.6',
            port: 9124,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli'],
              api_providers: ['openai'],
            },
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://127.0.0.1:9124',
      authToken: 'local-selected-token',
      hostId: 'embedded-runtime-current',
    });
  });

  it('uses the external selected target snapshot when the user explicitly points at an external runtime', () => {
    const result = resolvePtySpawnConnectionTarget({
      selectedTarget: buildSelectedTarget({
        mode: 'external',
        host: '192.168.1.48',
        port: 9124,
        authToken: 'external-selected-token',
      }),
      runtimeServiceStatus: buildRuntimeStatus(),
      runtimeHostSnapshots: [
        buildSnapshot({
          host: {
            id: 'remote-host',
            name: '192.168.1.48:9124',
            host: '192.168.1.48',
            port: 9124,
            authToken: 'remote-token',
          },
          topology: {
            host_id: 'remote-peer',
            hostname: 'remote-peer',
            os: 'Windows 11',
            arch: 'x64',
            uptime_secs: 120,
            version: '0.3.6',
            port: 9124,
            capabilities: {
              agent_kinds: ['claude_cli', 'codex_cli'],
              api_providers: ['openai'],
            },
          },
        }),
      ],
    });

    expect(result).toEqual({
      rtBaseUrl: 'http://192.168.1.48:9124',
      authToken: 'remote-token',
      hostId: 'remote-peer',
    });
  });
});
