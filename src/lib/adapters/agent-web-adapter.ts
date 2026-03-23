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
import { getLLMSettings, isLLMConfigured } from '@/config/llm-settings';
import { createUuidV4 } from '@/lib/utils/uuid';
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

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function buildChatMessages(
  history: AgentConversationMessage[],
  prompt: string,
): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: '你是 ExoMind 助手，帮助用户管理日常信息、整理思路、推进任务。回答简洁实用。' },
  ];

  for (const item of history) {
    messages.push({
      role: item.role === 'user' ? 'user' : 'assistant',
      content: item.content,
    });
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}

function extractSseContentDelta(data: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  if (!firstChoice) return null;

  const delta = firstChoice.delta as Record<string, unknown> | undefined;
  if (!delta) return null;

  const content = delta.content;
  return typeof content === 'string' ? content : null;
}

async function* streamOpenAICompatible(
  messages: OpenAIChatMessage[],
): AsyncGenerator<string, void, void> {
  const settings = getLLMSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error('LLM API returned empty body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n/);
      buffer = events.pop() ?? '';

      for (const line of events) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        const content = extractSseContentDelta(data);
        if (content) {
          yield content;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim();
      if (data && data !== '[DONE]') {
        const content = extractSseContentDelta(data);
        if (content) {
          yield content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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
      id: `msg-user-${createUuidV4()}`,
      role: 'user',
      content: input.prompt,
      createdAt: nowIso(),
    });

    const assistantMessageId = `msg-agent-${createUuidV4()}`;
    history.push({
      id: assistantMessageId,
      role: 'agent',
      content: '',
      createdAt: nowIso(),
    });

    if (!isLLMConfigured()) {
      const fallback = '请先在设置中配置 AI API Key 后使用对话功能。';
      const chunks = splitChunks(fallback);
      for (let index = 0; index < chunks.length; index += 1) {
        const delta = chunks[index];
        const assistant = history.find((item) => item.id === assistantMessageId);
        if (assistant) assistant.content += delta;
        yield { messageId: assistantMessageId, delta, done: index === chunks.length - 1 };
      }
      await this.storage.write(key, history);
      return;
    }

    const chatMessages = buildChatMessages(
      history.filter((item) => item.id !== assistantMessageId),
      input.prompt,
    );

    try {
      for await (const content of streamOpenAICompatible(chatMessages)) {
        const assistant = history.find((item) => item.id === assistantMessageId);
        if (assistant) assistant.content += content;
        yield { messageId: assistantMessageId, delta: content, done: false };
      }
      yield { messageId: assistantMessageId, delta: '', done: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fallback = `对话请求失败: ${errorMessage}`;
      const assistant = history.find((item) => item.id === assistantMessageId);
      if (assistant) assistant.content += fallback;
      yield { messageId: assistantMessageId, delta: fallback, done: true };
    }

    await this.storage.write(key, history);
  }
}
