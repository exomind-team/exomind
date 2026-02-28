import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { RuntimeTopologyResponse } from '@/lib/types/runtime-topology';
import {
  type AddRuntimeHostInput,
  type RuntimeHostService,
  getRuntimeHostService,
} from '@/lib/services/runtime-host.service';
import { RuntimeClient, type RuntimeAgentSummary } from './runtime-client';

export type RuntimeHostConnectionState = 'online' | 'error' | 'offline';

export interface RuntimeAggregatedAgent extends RuntimeAgentSummary {
  sourceHostId: string;
  sourceHostName: string;
  sourceHostAddress: string;
}

export interface RuntimeHostSnapshot {
  host: RuntimeHostRecord;
  connectionState: RuntimeHostConnectionState;
  agents: RuntimeAggregatedAgent[];
  topology: RuntimeTopologyResponse | null;
  error?: string;
}

export interface RuntimeManagerSnapshot {
  updatedAt: string;
  hosts: RuntimeHostSnapshot[];
  agents: RuntimeAggregatedAgent[];
}

export interface RuntimeManagerOptions {
  hostService?: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'removeHost'>;
  runtimeClient?: Pick<RuntimeClient, 'getAgents' | 'getTopology'>;
  now?: () => Date;
}

function mapErrorToConnectionState(errorCode: 'timeout' | 'network' | 'http' | 'invalid_payload'): RuntimeHostConnectionState {
  if (errorCode === 'network') return 'offline';
  return 'error';
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function parseHostAddress(hostAddress: string): { host: string; port: number } {
  const raw = hostAddress.trim();
  if (!raw) {
    throw new Error('host:port is required（必须输入 host:port）');
  }
  if (raw.includes('://') || raw.includes('/') || raw.includes('?') || raw.includes('#')) {
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const splitIndex = raw.lastIndexOf(':');
  if (splitIndex <= 0 || splitIndex === raw.length - 1) {
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const hostRaw = raw.slice(0, splitIndex).trim();
  const portRaw = raw.slice(splitIndex + 1).trim();
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']') ? hostRaw.slice(1, -1) : hostRaw;
  const port = Number.parseInt(portRaw, 10);

  if (!host) {
    throw new Error('host is required（host 不能为空）');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('port must be 1-65535（端口需在 1-65535）');
  }

  return { host, port };
}

export class RuntimeManager {
  private readonly hostService: Pick<RuntimeHostService, 'listHosts' | 'addHost' | 'removeHost'>;
  private readonly runtimeClient: Pick<RuntimeClient, 'getAgents' | 'getTopology'>;
  private readonly now: () => Date;

  constructor(options: RuntimeManagerOptions = {}) {
    this.hostService = options.hostService ?? getRuntimeHostService();
    this.runtimeClient = options.runtimeClient ?? new RuntimeClient();
    this.now = options.now ?? (() => new Date());
  }

  async refreshSnapshot(): Promise<RuntimeManagerSnapshot> {
    const hosts = await this.hostService.listHosts();
    const hostSnapshots = await Promise.all(hosts.map((host) => this.buildHostSnapshot(host)));
    const agents = hostSnapshots.flatMap((item) => item.agents);

    return {
      updatedAt: toIso(this.now),
      hosts: hostSnapshots,
      agents,
    };
  }

  async retryHost(hostId: string): Promise<RuntimeHostSnapshot | null> {
    const hosts = await this.hostService.listHosts();
    const target = hosts.find((item) => item.id === hostId);
    if (!target) return null;
    return this.buildHostSnapshot(target);
  }

  async addHost(input: AddRuntimeHostInput): Promise<RuntimeHostRecord> {
    return this.hostService.addHost(input);
  }

  async addHostFromAddress(hostAddress: string, name?: string): Promise<RuntimeHostRecord> {
    const parsed = parseHostAddress(hostAddress);
    return this.hostService.addHost({
      name: name?.trim(),
      host: parsed.host,
      port: parsed.port,
    });
  }

  async removeHost(hostId: string): Promise<void> {
    await this.hostService.removeHost(hostId);
  }

  private async buildHostSnapshot(host: RuntimeHostRecord): Promise<RuntimeHostSnapshot> {
    const [agentsResult, topologyResult] = await Promise.all([
      this.runtimeClient.getAgents(host),
      this.runtimeClient.getTopology(host),
    ]);

    if (!agentsResult.ok) {
      return {
        host,
        connectionState: mapErrorToConnectionState(agentsResult.error.code),
        agents: [],
        topology: topologyResult.ok ? topologyResult.data : null,
        error: agentsResult.error.message,
      };
    }

    const nextAgents: RuntimeAggregatedAgent[] = agentsResult.data.map((agent) => ({
      ...agent,
      sourceHostId: host.id,
      sourceHostName: host.name,
      sourceHostAddress: `${host.host}:${host.port}`,
    }));

    if (!topologyResult.ok) {
      return {
        host,
        connectionState: mapErrorToConnectionState(topologyResult.error.code),
        agents: nextAgents,
        topology: null,
        error: topologyResult.error.message,
      };
    }

    return {
      host,
      connectionState: 'online',
      agents: nextAgents,
      topology: topologyResult.data,
    };
  }
}

let runtimeManagerInstance: RuntimeManager | null = null;

export function getRuntimeManager(): RuntimeManager {
  if (!runtimeManagerInstance) {
    runtimeManagerInstance = new RuntimeManager();
  }
  return runtimeManagerInstance;
}

export function resetRuntimeManagerForTests(): void {
  runtimeManagerInstance = null;
}
