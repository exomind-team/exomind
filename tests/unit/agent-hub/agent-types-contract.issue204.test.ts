import { describe, expect, it } from 'vitest';
import { AGENT_HUB_VIEW_MODES } from '@/lib/types/agent-hub';
import { AGENT_PORT_KEYWORDS } from '@/lib/environment/interfaces/agent.port';
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
import type { IAgentPort } from '@/lib/environment/interfaces/agent.port';

function buildTopologyFixture(): AgentHubTopologyData {
  return {
    nodes: [
      {
        id: 'agent-daily',
        type: 'agent',
        name: '日报 Agent',
        status: 'running',
        layer: 'middle',
        brandColor: '#C75B3A',
      },
    ],
    edges: [
      {
        id: 'edge-rss-to-daily',
        fromNodeId: 'input-rss',
        toNodeId: 'agent-daily',
        color: '#C75B3A90',
      },
    ],
    selectedNodeId: 'agent-daily',
  };
}

class FakeAgentPort implements IAgentPort {
  async getTopology(): Promise<AgentHubTopologyData> {
    return buildTopologyFixture();
  }

  async getListView(): Promise<AgentHubListSection[]> {
    return [];
  }

  async getDeviceView(): Promise<AgentDeviceGroup[]> {
    return [];
  }

  async listAddNodeOptions(): Promise<AgentAddNodeOption[]> {
    return [];
  }

  async getAgentDetail(_agentId: string): Promise<AgentDetailData | null> {
    return null;
  }

  async getActorDetail(_actorId: string): Promise<AgentDetailData | null> {
    return null;
  }

  async listMarketCategories(): Promise<AgentMarketCategory[]> {
    return [];
  }

  async getMarketItems(_params?: { categoryId?: string; query?: string }): Promise<AgentMarketItem[]> {
    return [];
  }

  async getConversation(_agentId: string): Promise<AgentConversationMessage[]> {
    return [];
  }

  async *streamConversation(
    _input: { agentId: string; prompt: string }
  ): AsyncGenerator<AgentConversationChunk, void, void> {
    yield {
      messageId: 'msg-1',
      delta: '你好，',
      done: false,
    };
    yield {
      messageId: 'msg-1',
      delta: '世界',
      done: true,
    };
  }
}

describe('agent hub type contracts issue-204（Agent Hub 类型契约）', () => {
  it('exposes runtime constants for view mode and port contract（暴露运行时常量契约）', () => {
    expect(AGENT_HUB_VIEW_MODES).toEqual(['topology', 'list', 'history', 'routes', 'device']);
    expect(AGENT_PORT_KEYWORDS).toContain('streamConversation');
  });

  it('defines topology/list/device/detail/market/chat domain models（覆盖核心视图类型）', async () => {
    const port = new FakeAgentPort();
    const topology = await port.getTopology();

    expect(topology.nodes[0]?.name).toBe('日报 Agent');
    expect(topology.edges[0]?.toNodeId).toBe('agent-daily');
  });
});
