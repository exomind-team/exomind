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
import { createUuidV4 } from '@/lib/utils/uuid';
import { AGENT_HUB_MOCK_FIXTURE, type AgentHubMockFixture } from './fixtures/agent-hub';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function splitChunks(text: string, size = 8): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

// Agent mock adapter（测试数据适配器）
export class AgentMockAdapter implements IAgentPort {
  private readonly fixture: AgentHubMockFixture;
  private readonly conversations: Record<string, AgentConversationMessage[]>;

  constructor(fixture: AgentHubMockFixture = AGENT_HUB_MOCK_FIXTURE) {
    this.fixture = clone(fixture);
    this.conversations = clone(fixture.conversations);
  }

  async getTopology(): Promise<AgentHubTopologyData> {
    return clone(this.fixture.topology);
  }

  async getListView(): Promise<AgentHubListSection[]> {
    return clone(this.fixture.listSections);
  }

  async getDeviceView(): Promise<AgentDeviceGroup[]> {
    return clone(this.fixture.deviceGroups);
  }

  async listAddNodeOptions(): Promise<AgentAddNodeOption[]> {
    return clone(this.fixture.addNodeOptions);
  }

  async getAgentDetail(agentId: string): Promise<AgentDetailData | null> {
    return this.fixture.agentDetails[agentId] ? clone(this.fixture.agentDetails[agentId]) : null;
  }

  async getActorDetail(actorId: string): Promise<AgentDetailData | null> {
    return this.fixture.actorDetails[actorId] ? clone(this.fixture.actorDetails[actorId]) : null;
  }

  async listMarketCategories(): Promise<AgentMarketCategory[]> {
    return clone(this.fixture.marketCategories);
  }

  async getMarketItems(params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]> {
    const categoryId = params?.categoryId?.trim();
    const query = params?.query?.trim().toLowerCase();
    const byCategory = !categoryId || categoryId === 'all'
      ? this.fixture.marketItems
      : this.fixture.marketItems.filter((item) => item.tags.includes(categoryId));
    const byQuery = !query
      ? byCategory
      : byCategory.filter((item) => {
        const text = `${item.name} ${item.summary} ${item.tags.join(' ')}`.toLowerCase();
        return text.includes(query);
      });
    return clone(byQuery);
  }

  async getConversation(agentId: string): Promise<AgentConversationMessage[]> {
    const history = this.conversations[agentId] ?? [];
    return clone(history);
  }

  async *streamConversation(
    input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void> {
    const history = this.conversations[input.agentId] ?? [];
    if (!this.conversations[input.agentId]) {
      this.conversations[input.agentId] = history;
    }

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

    const response = `已收到：${input.prompt}。我会继续处理并在稍后同步结果。`;
    const chunks = splitChunks(response);

    for (let index = 0; index < chunks.length; index += 1) {
      const delta = chunks[index];
      const target = history.find((item) => item.id === assistantMessageId);
      if (target) {
        target.content += delta;
      }
      yield {
        messageId: assistantMessageId,
        delta,
        done: index === chunks.length - 1,
      };
    }
  }
}
