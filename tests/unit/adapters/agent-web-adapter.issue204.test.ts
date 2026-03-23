import { beforeEach, describe, expect, it } from 'vitest';
import { AgentWebAdapter, AGENT_WEB_STORAGE_KEYS } from '@/lib/adapters/agent-web-adapter';
import type { AgentHubTopologyData } from '@/lib/types/agent-hub';

describe('agent web adapter issue-204（Agent Web 适配器）', () => {
  let adapter: AgentWebAdapter;

  beforeEach(() => {
    window.localStorage.clear();
    adapter = new AgentWebAdapter();
  });

  it('returns safe defaults when storage is empty（无数据时返回安全默认值）', async () => {
    const topology = await adapter.getTopology();
    const listView = await adapter.getListView();
    const deviceView = await adapter.getDeviceView();
    const addNodeOptions = await adapter.listAddNodeOptions();

    expect(topology.nodes).toEqual([]);
    expect(topology.edges).toEqual([]);
    expect(listView).toEqual([]);
    expect(deviceView).toEqual([]);
    expect(addNodeOptions.length).toBeGreaterThan(0);
  });

  it('reads topology data from storage（可从存储读取拓扑）', async () => {
    const seededTopology: AgentHubTopologyData = {
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
      edges: [],
      selectedNodeId: null,
    };

    window.localStorage.setItem(
      `exomind_${AGENT_WEB_STORAGE_KEYS.topology}`,
      JSON.stringify(seededTopology)
    );

    const topology = await adapter.getTopology();
    expect(topology.nodes[0]?.name).toBe('日报 Agent');
  });

  it('prompts API key configuration when not set（未配置 API Key 时提示配置）', async () => {
    const deltas: string[] = [];

    for await (const chunk of adapter.streamConversation({
      agentId: 'agent-web',
      prompt: 'hello',
    })) {
      deltas.push(chunk.delta);
    }

    expect(deltas.join('')).toContain('API Key');
  });
});

