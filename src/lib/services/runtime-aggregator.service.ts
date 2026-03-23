import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import type { RuntimeTopologyResponse } from '@/lib/types/runtime-topology';
import { getRuntimeHostService } from './runtime-host.service';
import { formatHostForUrl } from '@/config/runtime-target';
import { log } from '@/lib/logger';

export interface RuntimeAgentInfo {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'busy' | 'error';
  hostId: string;
  hostName: string;
}

export interface AggregatedRuntimeData {
  hosts: RuntimeHostRecord[];
  agents: RuntimeAgentInfo[];
  topologies: Map<string, RuntimeTopologyResponse>;
}

export interface RuntimeAggregatorService {
  aggregateAll(): Promise<AggregatedRuntimeData>;
  getAgentsByHost(hostId: string): Promise<RuntimeAgentInfo[]>;
  getTopologyByHost(hostId: string): Promise<RuntimeTopologyResponse | null>;
}

type RuntimeFetch = typeof fetch;

export interface RuntimeAggregatorServiceOptions {
  fetchImpl?: RuntimeFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

export class RuntimeAggregatorServiceImpl implements RuntimeAggregatorService {
  private readonly fetchImpl: RuntimeFetch;
  private readonly timeoutMs: number;

  constructor(options: RuntimeAggregatorServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async aggregateAll(): Promise<AggregatedRuntimeData> {
    const hostService = getRuntimeHostService();
    const hosts = await hostService.listHosts();

    const onlineHosts = hosts.filter(h => h.status === 'online');

    const agents: RuntimeAgentInfo[] = [];
    const topologies = new Map<string, RuntimeTopologyResponse>();

    await Promise.all(
      onlineHosts.map(async (host) => {
        try {
          // Fetch agents
          const hostAgents = await this.fetchAgents(host);
          agents.push(...hostAgents);

          // Fetch topology
          const topology = await this.fetchTopology(host);
          if (topology) {
            topologies.set(host.id, topology);
          }
        } catch (error) {
          log.warn(`Failed to fetch data from host ${host.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );

    return { hosts, agents, topologies };
  }

  async getAgentsByHost(hostId: string): Promise<RuntimeAgentInfo[]> {
    const hostService = getRuntimeHostService();
    const hosts = await hostService.listHosts();
    const host = hosts.find(h => h.id === hostId);

    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }

    return this.fetchAgents(host);
  }

  async getTopologyByHost(hostId: string): Promise<RuntimeTopologyResponse | null> {
    const hostService = getRuntimeHostService();
    const hosts = await hostService.listHosts();
    const host = hosts.find(h => h.id === hostId);

    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }

    return this.fetchTopology(host);
  }

  private async fetchAgents(host: RuntimeHostRecord): Promise<RuntimeAgentInfo[]> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`http://${formatHostForUrl(host.host)}:${host.port}/agents`, {
        method: 'GET',
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((agent: any) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description || '',
        status: agent.status || 'available',
        hostId: host.id,
        hostName: host.name,
      }));
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async fetchTopology(host: RuntimeHostRecord): Promise<RuntimeTopologyResponse | null> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`http://${formatHostForUrl(host.host)}:${host.port}/topology`, {
        method: 'GET',
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

let runtimeAggregatorServiceInstance: RuntimeAggregatorService | null = null;

export function getRuntimeAggregatorService(): RuntimeAggregatorService {
  if (!runtimeAggregatorServiceInstance) {
    runtimeAggregatorServiceInstance = new RuntimeAggregatorServiceImpl();
  }
  return runtimeAggregatorServiceInstance;
}

export function resetRuntimeAggregatorServiceForTests(): void {
  runtimeAggregatorServiceInstance = null;
}
