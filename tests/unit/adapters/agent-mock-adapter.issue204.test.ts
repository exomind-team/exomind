import { beforeEach, describe, expect, it } from 'vitest';
import { AgentMockAdapter } from '@/lib/adapters/mock/agent-mock-adapter';

describe('agent mock adapter issue-204（Agent Mock 适配器）', () => {
  let adapter: AgentMockAdapter;

  beforeEach(() => {
    adapter = new AgentMockAdapter();
  });

  it('returns topology/list/device/add-node data（返回拓扑/列表/设备/添加节点数据）', async () => {
    const [topology, listView, deviceView, addNodeOptions] = await Promise.all([
      adapter.getTopology(),
      adapter.getListView(),
      adapter.getDeviceView(),
      adapter.listAddNodeOptions(),
    ]);

    expect(topology.nodes.length).toBeGreaterThan(0);
    expect(listView.length).toBeGreaterThan(0);
    expect(deviceView.length).toBeGreaterThan(0);
    expect(addNodeOptions.map((item) => item.id)).toContain('market');
  });

  it('supports market query filter（支持市场分类和关键字筛选）', async () => {
    const all = await adapter.getMarketItems();
    const filteredByCategory = await adapter.getMarketItems({ categoryId: 'agent' });
    const filteredByQuery = await adapter.getMarketItems({ query: 'Code' });

    expect(all.length).toBeGreaterThan(0);
    expect(filteredByCategory.every((item) => item.tags.includes('agent'))).toBe(true);
    expect(filteredByQuery.some((item) => item.name.includes('Code'))).toBe(true);
  });

  it('streams response chunks and marks done（流式返回分片并结束）', async () => {
    const chunks = [];
    for await (const chunk of adapter.streamConversation({
      agentId: 'agent-daily',
      prompt: '今天的总结',
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.at(-1)?.done).toBe(true);
  });
});

