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

// Runtime keywords（运行时关键词）for contract assertions（契约断言）
export const AGENT_PORT_KEYWORDS = [
  'getTopology',
  'getListView',
  'getDeviceView',
  'listAddNodeOptions',
  'getAgentDetail',
  'getActorDetail',
  'listMarketCategories',
  'getMarketItems',
  'getConversation',
  'streamConversation',
] as const;

export interface AgentMarketQuery {
  categoryId?: string;
  query?: string;
}

export interface StreamAgentConversationInput {
  agentId: string;
  prompt: string;
}

export interface IAgentPort {
  getTopology(): Promise<AgentHubTopologyData>;
  getListView(): Promise<AgentHubListSection[]>;
  getDeviceView(): Promise<AgentDeviceGroup[]>;
  listAddNodeOptions(): Promise<AgentAddNodeOption[]>;
  getAgentDetail(agentId: string): Promise<AgentDetailData | null>;
  getActorDetail(actorId: string): Promise<AgentDetailData | null>;
  listMarketCategories(): Promise<AgentMarketCategory[]>;
  getMarketItems(params?: AgentMarketQuery): Promise<AgentMarketItem[]>;
  getConversation(agentId: string): Promise<AgentConversationMessage[]>;
  streamConversation(
    input: StreamAgentConversationInput
  ): AsyncGenerator<AgentConversationChunk, void, void>;
}

