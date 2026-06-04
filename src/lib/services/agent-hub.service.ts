import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { IAgentPort } from '@/lib/environment/interfaces/agent.port';
import type {
  AgentAddNodeOption,
  AgentConversationChunk,
  AgentConversationMessage,
  AgentDetailData,
  AgentDeviceGroup,
  AgentHubListSection,
  AgentHubTopologyData,
  AgentMarketCategory,
  AgentMarketItem,
} from '@/lib/types/agent-hub';
import { getRuntimeAggregatorService } from './runtime-aggregator.service';
import { getRuntimeHostService } from './runtime-host.service';
import {
  resolveRuntimeHostBaseUrl,
  buildRuntimeAuthHeaders,
} from '@/lib/utils/runtime-host-address';
import { buildDirectRuntimeCandidates } from '@/ui/app/pages/agents/agents-utils';

type AgentEnvironmentLike = {
  agent: IAgentPort;
};

export interface AgentHubService {
  getTopology(): Promise<AgentHubTopologyData>;
  getListView(): Promise<AgentHubListSection[]>;
  getDeviceView(): Promise<AgentDeviceGroup[]>;
  listAddNodeOptions(): Promise<AgentAddNodeOption[]>;
  getAgentDetail(agentId: string): Promise<AgentDetailData | null>;
  getActorDetail(actorId: string): Promise<AgentDetailData | null>;
  listMarketCategories(): Promise<AgentMarketCategory[]>;
  getMarketItems(params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]>;
  getConversation(agentId: string): Promise<AgentConversationMessage[]>;
  streamConversation(
    input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void>;
}

export class AgentHubServiceImpl implements AgentHubService {
  private readonly injectedEnv: AgentEnvironmentLike | null;

  constructor(env?: AgentEnvironmentLike) {
    this.injectedEnv = env ?? null;
  }

  private getAgentPort(): IAgentPort {
    if (this.injectedEnv) {
      return this.injectedEnv.agent;
    }
    return ExoMindEnvironment.getInstance().agent;
  }

  async getTopology(): Promise<AgentHubTopologyData> {
    return this.getAgentPort().getTopology();
  }

  async getListView(): Promise<AgentHubListSection[]> {
    return this.getAgentPort().getListView();
  }

  async getDeviceView(): Promise<AgentDeviceGroup[]> {
    // 获取聚合的运行时数据
    const aggregatorService = getRuntimeAggregatorService();
    const aggregatedData = await aggregatorService.aggregateAll();

    // 按主机分组 agents
    const groups: AgentDeviceGroup[] = [];

    for (const host of aggregatedData.hosts) {
      const hostAgents = aggregatedData.agents.filter(a => a.hostId === host.id);

      // 构建设备卡片
      const cards = hostAgents.map(agent => ({
        id: agent.id,
        name: agent.name,
        type: 'server' as const,
        status: host.status === 'online' ? 'online' as const : 'offline' as const,
        summary: agent.description,
        metrics: [
          { label: 'Host', value: host.name },
          { label: 'Status', value: agent.status },
        ],
        tags: [
          { id: `${agent.id}-host`, label: host.name, color: '#C75B3A' },
        ],
        isHost: host.isLocal,
      }));

      if (cards.length > 0 || host.status === 'online') {
        groups.push({
          id: host.id,
          title: host.name,
          summary: `${host.host}:${host.port} - ${hostAgents.length} agents`,
          cards,
        });
      }
    }

    // 如果没有任何主机，返回 mock 数据作为后备
    if (groups.length === 0) {
      return this.getAgentPort().getDeviceView();
    }

    return groups;
  }

  async listAddNodeOptions(): Promise<AgentAddNodeOption[]> {
    return this.getAgentPort().listAddNodeOptions();
  }

  async getAgentDetail(agentId: string): Promise<AgentDetailData | null> {
    // Try localStorage first (agent hub registered agents)
    const detail = await this.getAgentPort().getAgentDetail(agentId);
    if (detail) return detail;

    // Fallback: built-in agents not in localStorage — fetch from Runtime API
    // Use direct runtime candidates (same mechanism as AgentsPage)
    try {
      const existingHosts = await getRuntimeHostService().listHosts();
      const existingSnapshots = existingHosts.map((h) => ({
        host: h,
        connectionState: 'connected',
        topology: null,
        agents: [],
      }));
      const candidates = buildDirectRuntimeCandidates(existingSnapshots as any[]);
      const allHosts = [...existingHosts, ...candidates];
      for (const host of allHosts) {
        try {
          const response = await fetch(
            `${resolveRuntimeHostBaseUrl(host)}/agents`,
            {
              headers: buildRuntimeAuthHeaders(host.authToken),
            },
          );
          if (!response.ok) continue;
          const agents = await response.json();
          if (!Array.isArray(agents)) continue;
          const match = agents.find((a: any) => a.id === agentId);
          if (match) {
            return {
              id: match.id,
              type: 'agent',
              title: match.name || match.id,
              status: match.status === 'available' ? 'running' : 'offline',
              description: match.description || '',
              icon: 'brain',
              tintColor: '#0D9488',
              stats: [
                { label: 'Status', value: match.status || 'unknown' },
                ...(match.subscriptions?.length
                  ? [{ label: 'Subscriptions', value: match.subscriptions.join(', ') }]
                  : []),
              ],
              triggerRules: [],
              targets: [],
              recentLogs: [],
            };
          }
        } catch {
          // Host unreachable — try next candidate
        }
      }
    } catch {
      // Ignore errors — return null as before
    }
    return null;
  }

  async getActorDetail(actorId: string): Promise<AgentDetailData | null> {
    return this.getAgentPort().getActorDetail(actorId);
  }

  async listMarketCategories(): Promise<AgentMarketCategory[]> {
    return this.getAgentPort().listMarketCategories();
  }

  async getMarketItems(params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]> {
    return this.getAgentPort().getMarketItems(params);
  }

  async getConversation(agentId: string): Promise<AgentConversationMessage[]> {
    return this.getAgentPort().getConversation(agentId);
  }

  streamConversation(
    input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void> {
    return this.getAgentPort().streamConversation(input);
  }
}

let agentHubServiceInstance: AgentHubService | null = null;

export function getAgentHubService(): AgentHubService {
  if (!agentHubServiceInstance) {
    agentHubServiceInstance = new AgentHubServiceImpl();
  }
  return agentHubServiceInstance;
}
