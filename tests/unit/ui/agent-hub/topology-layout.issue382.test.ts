import { describe, expect, it } from 'vitest';
import type { SignalGraph } from '@/ui/app/pages/agents-signal-topology';
import {
  applyManualLayoutSnapshot,
  buildAutoFlowLayout,
  buildTopologyDatasetKey,
  buildTopologyFilterKey,
  readTopologyLayoutStore,
  setTopologyLayoutSnapshot,
  writeTopologyLayoutStore,
  type TopologyLayoutSnapshot,
} from '@/ui/app/pages/topology-layout';

const SAMPLE_GRAPH: SignalGraph = {
  nodes: [
    {
      id: 'topic:user.input.text',
      type: 'topic',
      label: 'user.input.text',
      status: 'signal topic（信号主题）',
      position: { x: 120, y: 80 },
    },
    {
      id: 'agent:classifier',
      type: 'agent',
      label: 'classifier',
      status: 'available',
      position: { x: 600, y: 80 },
    },
    {
      id: 'actor:eventlog',
      type: 'actor',
      label: 'eventlog',
      status: 'actor',
      position: { x: 840, y: 80 },
    },
  ],
  edges: [
    {
      id: 'route:001',
      source: 'topic:user.input.text',
      target: 'agent:classifier',
      label: 'user.input.text → classifier',
      topic: 'user.input.text',
      targetType: 'agent',
      targetRef: 'classifier',
      active: true,
    },
    {
      id: 'route:002',
      source: 'topic:user.input.text',
      target: 'actor:eventlog',
      label: 'user.input.text → eventlog',
      topic: 'user.input.text',
      targetType: 'actor',
      targetRef: 'eventlog',
      active: true,
    },
  ],
};

function createMemoryStorage(initialStore?: Record<string, string>) {
  const store = new Map(Object.entries(initialStore ?? {}));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe('topology layout helpers issue-382（拓扑布局持久化纯函数）', () => {
  it('keeps datasetKey stable when only status changes（仅状态变化时 datasetKey 保持稳定）', () => {
    const baseKey = buildTopologyDatasetKey(SAMPLE_GRAPH);
    const changedStatusKey = buildTopologyDatasetKey({
      ...SAMPLE_GRAPH,
      nodes: SAMPLE_GRAPH.nodes.map((node) => (
        node.id === 'agent:classifier'
          ? { ...node, status: 'busy', position: { x: 999, y: 777 } }
          : node
      )),
    });

    expect(changedStatusKey).toBe(baseKey);
  });

  it('keeps datasetKey stable when only labels or edge activity change（仅显示标签或边活跃态变化时 datasetKey 保持稳定）', () => {
    const baseKey = buildTopologyDatasetKey(SAMPLE_GRAPH);
    const changedLabelKey = buildTopologyDatasetKey({
      ...SAMPLE_GRAPH,
      nodes: SAMPLE_GRAPH.nodes.map((node) => (
        node.id === 'agent:classifier'
          ? { ...node, label: 'Classifier Agent' }
          : node
      )),
      edges: SAMPLE_GRAPH.edges.map((edge) => (
        edge.id === 'route:001'
          ? { ...edge, label: 'renamed edge', active: false }
          : edge
      )),
    });

    expect(changedLabelKey).toBe(baseKey);
  });

  it('changes datasetKey when node or edge collection changes（节点或边集合变化时 datasetKey 变化）', () => {
    const baseKey = buildTopologyDatasetKey(SAMPLE_GRAPH);
    const changedNodeKey = buildTopologyDatasetKey({
      ...SAMPLE_GRAPH,
      nodes: [
        ...SAMPLE_GRAPH.nodes,
        {
          id: 'frontend:ui',
          type: 'frontend',
          label: 'ui',
          status: 'frontend',
          position: { x: 1080, y: 80 },
        },
      ],
    });
    const changedEdgeKey = buildTopologyDatasetKey({
      ...SAMPLE_GRAPH,
      edges: SAMPLE_GRAPH.edges.slice(0, 1),
    });

    expect(changedNodeKey).not.toBe(baseKey);
    expect(changedEdgeKey).not.toBe(baseKey);
  });

  it('builds stable filterKey regardless of object or array order（筛选键对对象键顺序与数组顺序稳定）', () => {
    const keyA = buildTopologyFilterKey({
      nodesFilter: 'agent',
      targetTypes: ['actor', 'agent'],
      topicGroups: ['critical', 'default'],
    });
    const keyB = buildTopologyFilterKey({
      topicGroups: ['default', 'critical'],
      targetTypes: ['agent', 'actor'],
      nodesFilter: 'agent',
    });

    expect(keyA).toBe(keyB);
  });

  it('applies saved manual positions, keeps new nodes on base layout, and drops stale positions（合并手动布局并清理失效节点）', () => {
    const snapshot: TopologyLayoutSnapshot = {
      manualPositions: {
        'agent:classifier': { x: 720, y: 260 },
        'actor:eventlog': { x: 930, y: 210 },
        'agent:stale': { x: 10, y: 10 },
      },
      viewport: { x: 12, y: 34, zoom: 0.8 },
      updatedAt: '2026-03-06T12:00:00.000Z',
    };

    const merged = applyManualLayoutSnapshot({
      nodes: [
        ...SAMPLE_GRAPH.nodes,
        {
          id: 'frontend:ui',
          type: 'frontend',
          label: 'ui',
          status: 'frontend',
          position: { x: 1080, y: 80 },
        },
      ],
      snapshot,
    });

    expect(merged.nodes.find((node) => node.id === 'agent:classifier')?.position).toEqual({ x: 720, y: 260 });
    expect(merged.nodes.find((node) => node.id === 'actor:eventlog')?.position).toEqual({ x: 930, y: 210 });
    expect(merged.nodes.find((node) => node.id === 'frontend:ui')?.position).toEqual({ x: 1080, y: 80 });
    expect(merged.cleanedSnapshot.manualPositions).not.toHaveProperty('agent:stale');
    expect(merged.cleanedSnapshot.viewport).toEqual({ x: 12, y: 34, zoom: 0.8 });
  });

  it('writes and reads layout snapshots through storage（布局快照可读写存储）', () => {
    const storage = createMemoryStorage();
    const datasetKey = buildTopologyDatasetKey(SAMPLE_GRAPH);
    const snapshot: TopologyLayoutSnapshot = {
      manualPositions: {
        'agent:classifier': { x: 700, y: 200 },
      },
      viewport: { x: 1, y: 2, zoom: 0.9 },
      updatedAt: '2026-03-06T12:34:56.000Z',
    };

    const store = setTopologyLayoutSnapshot(
      {},
      { datasetKey, scopeKey: 'global', filterKey: 'nodesFilter=all', snapshot },
    );
    writeTopologyLayoutStore(store, storage);

    expect(readTopologyLayoutStore(storage)).toEqual({
      [datasetKey]: {
        global: {
          'nodesFilter=all': snapshot,
        },
      },
    });
  });

  it('builds auto flow layout from base positions（自动布局一期回退当前基础布局）', () => {
    const autoNodes = buildAutoFlowLayout(SAMPLE_GRAPH.nodes);
    expect(autoNodes).toEqual(SAMPLE_GRAPH.nodes);
  });
});
