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
    return this.getAgentPort().getAgentDetail(agentId);
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
