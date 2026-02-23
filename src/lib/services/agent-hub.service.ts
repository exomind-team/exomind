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
  private readonly env: AgentEnvironmentLike;

  constructor(env?: AgentEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance();
  }

  async getTopology(): Promise<AgentHubTopologyData> {
    return this.env.agent.getTopology();
  }

  async getListView(): Promise<AgentHubListSection[]> {
    return this.env.agent.getListView();
  }

  async getDeviceView(): Promise<AgentDeviceGroup[]> {
    return this.env.agent.getDeviceView();
  }

  async listAddNodeOptions(): Promise<AgentAddNodeOption[]> {
    return this.env.agent.listAddNodeOptions();
  }

  async getAgentDetail(agentId: string): Promise<AgentDetailData | null> {
    return this.env.agent.getAgentDetail(agentId);
  }

  async getActorDetail(actorId: string): Promise<AgentDetailData | null> {
    return this.env.agent.getActorDetail(actorId);
  }

  async listMarketCategories(): Promise<AgentMarketCategory[]> {
    return this.env.agent.listMarketCategories();
  }

  async getMarketItems(params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]> {
    return this.env.agent.getMarketItems(params);
  }

  async getConversation(agentId: string): Promise<AgentConversationMessage[]> {
    return this.env.agent.getConversation(agentId);
  }

  streamConversation(
    input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void> {
    return this.env.agent.streamConversation(input);
  }
}

let agentHubServiceInstance: AgentHubService | null = null;

export function getAgentHubService(): AgentHubService {
  if (!agentHubServiceInstance) {
    agentHubServiceInstance = new AgentHubServiceImpl();
  }
  return agentHubServiceInstance;
}

