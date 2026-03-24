import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentPort } from '@/lib/environment/interfaces/agent.port';

function createAgentPort(label: string): IAgentPort {
  return {
    getTopology: vi.fn(async () => ({
      nodes: [{ id: `node-${label}`, type: 'agent', name: label, status: 'running', layer: 'middle', brandColor: '#C75B3A' }],
      edges: [],
      selectedNodeId: null,
    })),
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
        messageId: `msg-${label}`,
        delta: label,
        done: true,
      };
    }),
  };
}

describe('agent hub service mock toggle issue-204（切换 mock 数据后应生效）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('re-reads environment when adapter source changes（切换后应读取新环境）', async () => {
    const mockAgentPort = createAgentPort('mock');
    const webAgentPort = createAgentPort('web');

    let currentEnv: { agent: IAgentPort } = { agent: webAgentPort };
    const getInstance = vi.fn(() => currentEnv);

    vi.doMock('@/lib/environment/environment', () => ({
      ExoMindEnvironment: {
        getInstance,
      },
    }));

    const module = await import('@/lib/services/agent-hub.service');
    const service = module.getAgentHubService();

    await service.getTopology();
    expect(webAgentPort.getTopology).toHaveBeenCalledTimes(1);
    expect(mockAgentPort.getTopology).toHaveBeenCalledTimes(0);

    currentEnv = { agent: mockAgentPort };
    await service.getTopology();

    expect(mockAgentPort.getTopology).toHaveBeenCalledTimes(1);
    expect(getInstance).toHaveBeenCalledTimes(2);
  });
});

