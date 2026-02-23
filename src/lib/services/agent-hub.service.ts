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
    return this.getAgentPort().getDeviceView();
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
