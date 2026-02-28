import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHubServiceImpl } from '@/lib/services/agent-hub.service';
import type { IAgentPort } from '@/lib/environment/interfaces/agent.port';

describe('agent hub service issue-204（Agent Hub 服务）', () => {
  let agentPort: IAgentPort;
  let service: AgentHubServiceImpl;

  beforeEach(() => {
    agentPort = {
      getTopology: vi.fn(async () => ({ nodes: [], edges: [], selectedNodeId: null })),
      getListView: vi.fn(async () => []),
      getDeviceView: vi.fn(async () => []),
      listAddNodeOptions: vi.fn(async () => []),
      getAgentDetail: vi.fn(async () => null),
      getActorDetail: vi.fn(async () => null),
      listMarketCategories: vi.fn(async () => []),
      getMarketItems: vi.fn(async () => []),
      getConversation: vi.fn(async () => []),
      streamConversation: vi.fn(async function* () {
        yield {
          messageId: 'msg-1',
          delta: 'hello',
          done: true,
        };
      }),
    };

    service = new AgentHubServiceImpl({ agent: agentPort });
  });

  it('delegates reads to agent port（读取请求转发到 agent port）', async () => {
    await service.getTopology();
    await service.getListView();
    await service.getDeviceView();
    await service.listAddNodeOptions();
    await service.listMarketCategories();
    await service.getMarketItems({ categoryId: 'agent' });

    expect(agentPort.getTopology).toHaveBeenCalledTimes(1);
    expect(agentPort.getListView).toHaveBeenCalledTimes(1);
    expect(agentPort.getDeviceView).toHaveBeenCalledTimes(1);
    expect(agentPort.listAddNodeOptions).toHaveBeenCalledTimes(1);
    expect(agentPort.listMarketCategories).toHaveBeenCalledTimes(1);
    expect(agentPort.getMarketItems).toHaveBeenCalledWith({ categoryId: 'agent' });
  });

  it('delegates detail and chat methods（详情与对话方法转发）', async () => {
    await service.getAgentDetail('agent-1');
    await service.getActorDetail('actor-1');
    await service.getConversation('agent-1');

    const chunks = [];
    for await (const chunk of service.streamConversation({ agentId: 'agent-1', prompt: 'hi' })) {
      chunks.push(chunk);
    }

    expect(agentPort.getAgentDetail).toHaveBeenCalledWith('agent-1');
    expect(agentPort.getActorDetail).toHaveBeenCalledWith('actor-1');
    expect(agentPort.getConversation).toHaveBeenCalledWith('agent-1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.done).toBe(true);
  });
});

