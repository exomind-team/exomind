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
import { WebStorageAdapter } from './web-storage';

// Storage keys（存储键）
export const AGENT_WEB_STORAGE_KEYS = {
  topology: 'agent_hub_topology',
  listView: 'agent_hub_list_view',
  deviceView: 'agent_hub_device_view',
  marketCategories: 'agent_hub_market_categories',
  marketItems: 'agent_hub_market_items',
  addNodeOptions: 'agent_hub_add_node_options',
  agentDetailPrefix: 'agent_hub_agent_detail_',
  actorDetailPrefix: 'agent_hub_actor_detail_',
  conversationPrefix: 'agent_hub_conversation_',
} as const;

const FALLBACK_ADD_NODE_OPTIONS: AgentAddNodeOption[] = [
  { id: 'input', title: '添加信号输入', description: '新增 RSS / API / 传感器输入', icon: 'rss', tintColor: '#F97316' },
  { id: 'agent', title: '添加 Agent', description: '基于大模型的智能决策节点', icon: 'brain', tintColor: '#C75B3A' },
  { id: 'actor', title: '添加 Actor', description: '定时、条件触发的程序执行节点', icon: 'timer', tintColor: '#78716C' },
  { id: 'output', title: '添加输出节点', description: '消息通知、写库、API 回调等输出', icon: 'send', tintColor: '#2AABEE' },
  { id: 'market', title: '从市场安装', description: '浏览社区插件并一键接入节点', icon: 'shopping-bag', tintColor: '#8B5CF6' },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function splitChunks(text: string, size = 10): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

export class AgentWebAdapter implements IAgentPort {
  private readonly storage = new WebStorageAdapter();

  private async readOrDefault<T>(key: string, fallback: T): Promise<T> {
    const value = await this.storage.read<T>(key);
    if (value === null || value === undefined) return clone(fallback);
    return clone(value);
  }

  async getTopology(): Promise<AgentHubTopologyData> {
    return this.readOrDefault(AGENT_WEB_STORAGE_KEYS.topology, {
      nodes: [],
      edges: [],
      selectedNodeId: null,
    });
  }

  async getListView(): Promise<AgentHubListSection[]> {
    return this.readOrDefault(AGENT_WEB_STORAGE_KEYS.listView, []);
  }

  async getDeviceView(): Promise<AgentDeviceGroup[]> {
    return this.readOrDefault(AGENT_WEB_STORAGE_KEYS.deviceView, []);
  }

  async listAddNodeOptions(): Promise<AgentAddNodeOption[]> {
    return this.readOrDefault(AGENT_WEB_STORAGE_KEYS.addNodeOptions, FALLBACK_ADD_NODE_OPTIONS);
  }

  async getAgentDetail(agentId: string): Promise<AgentDetailData | null> {
    const key = `${AGENT_WEB_STORAGE_KEYS.agentDetailPrefix}${agentId}`;
    const detail = await this.storage.read<AgentDetailData>(key);
    return detail ? clone(detail) : null;
  }

  async getActorDetail(actorId: string): Promise<AgentDetailData | null> {
    const key = `${AGENT_WEB_STORAGE_KEYS.actorDetailPrefix}${actorId}`;
    const detail = await this.storage.read<AgentDetailData>(key);
    return detail ? clone(detail) : null;
  }

  async listMarketCategories(): Promise<AgentMarketCategory[]> {
    return this.readOrDefault(AGENT_WEB_STORAGE_KEYS.marketCategories, []);
  }

  async getMarketItems(params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]> {
    const all = await this.readOrDefault<AgentMarketItem[]>(AGENT_WEB_STORAGE_KEYS.marketItems, []);
    const categoryId = params?.categoryId?.trim();
    const query = params?.query?.trim().toLowerCase();
    const byCategory = !categoryId || categoryId === 'all'
      ? all
      : all.filter((item) => item.tags.includes(categoryId));
    const byQuery = !query
      ? byCategory
      : byCategory.filter((item) => {
        const text = `${item.name} ${item.summary} ${item.tags.join(' ')}`.toLowerCase();
        return text.includes(query);
      });
    return clone(byQuery);
  }

  async getConversation(agentId: string): Promise<AgentConversationMessage[]> {
    const key = `${AGENT_WEB_STORAGE_KEYS.conversationPrefix}${agentId}`;
    return this.readOrDefault(key, []);
  }

  async *streamConversation(
    input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void> {
    const key = `${AGENT_WEB_STORAGE_KEYS.conversationPrefix}${input.agentId}`;
    const history = await this.getConversation(input.agentId);

    history.push({
      id: `msg-user-${crypto.randomUUID()}`,
      role: 'user',
      content: input.prompt,
      createdAt: nowIso(),
    });

    const assistantMessageId = `msg-agent-${crypto.randomUUID()}`;
    history.push({
      id: assistantMessageId,
      role: 'agent',
      content: '',
      createdAt: nowIso(),
    });

    const response = 'web adapter placeholder response';
    const chunks = splitChunks(response);
    for (let index = 0; index < chunks.length; index += 1) {
      const delta = chunks[index];
      const assistant = history.find((item) => item.id === assistantMessageId);
      if (assistant) assistant.content += delta;
      yield {
        messageId: assistantMessageId,
        delta,
        done: index === chunks.length - 1,
      };
    }

    await this.storage.write(key, history);
  }
}

