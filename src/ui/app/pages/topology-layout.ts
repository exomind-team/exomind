import type { SignalGraphNode, SignalGraphEdge } from './agents-signal-topology';

export const TOPOLOGY_LAYOUT_STORAGE_KEY = 'exomind:agentHubTopologyLayouts';

export type TopologyLayoutMode = 'manual' | 'auto:flow';

export type TopologyNodePosition = {
  x: number;
  y: number;
};

export type TopologyViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type TopologyLayoutSnapshot = {
  manualPositions: Record<string, TopologyNodePosition>;
  viewport?: TopologyViewport;
  updatedAt: string;
};

export type TopologyLayoutStore = Record<
  string,
  Record<string, Record<string, TopologyLayoutSnapshot>>
>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type TopologyFilterInput = {
  nodesFilter?: string | null;
  targetTypes?: string[];
  topicGroups?: string[];
};

type LayoutWorkspaceKey = {
  datasetKey: string;
  scopeKey: string;
  filterKey: string;
};

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function sortObjectKeys<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const nextValue = value[key];
      if (nextValue === undefined || nextValue === null || nextValue === '') {
        return acc;
      }
      if (Array.isArray(nextValue)) {
        acc[key] = [...nextValue].sort();
        return acc;
      }
      acc[key] = nextValue;
      return acc;
    }, {});
}

function normalizeNodeFingerprint(node: SignalGraphNode): string {
  return `${node.id}|${node.type}`;
}

function normalizeEdgeFingerprint(edge: SignalGraphEdge): string {
  return `${edge.id}|${edge.source}|${edge.target}|${edge.topic}|${edge.targetType}|${edge.targetRef}`;
}

function hashStableString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildTopologyDatasetKey({
  nodes,
  edges,
}: {
  nodes: SignalGraphNode[];
  edges: SignalGraphEdge[];
}): string {
  const nodeFingerprint = [...nodes]
    .map(normalizeNodeFingerprint)
    .sort()
    .join('||');
  const edgeFingerprint = [...edges]
    .map(normalizeEdgeFingerprint)
    .sort()
    .join('||');
  return `dataset:${nodes.length}:${edges.length}:${hashStableString(nodeFingerprint)}:${hashStableString(edgeFingerprint)}`;
}

export function buildTopologyFilterKey(input: TopologyFilterInput = {}): string {
  const normalized = sortObjectKeys(input);
  if (Object.keys(normalized).length === 0) {
    return 'nodesFilter=all';
  }
  return Object.entries(normalized)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join('&');
}

export function readTopologyLayoutStore(storage = getDefaultStorage()): TopologyLayoutStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(TOPOLOGY_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as TopologyLayoutStore) : {};
  } catch {
    return {};
  }
}

export function writeTopologyLayoutStore(
  store: TopologyLayoutStore,
  storage = getDefaultStorage(),
): void {
  if (!storage) return;
  const hasEntries = Object.keys(store).length > 0;
  if (!hasEntries) {
    storage.removeItem(TOPOLOGY_LAYOUT_STORAGE_KEY);
    return;
  }
  storage.setItem(TOPOLOGY_LAYOUT_STORAGE_KEY, JSON.stringify(store));
}

export function getTopologyLayoutSnapshot(
  store: TopologyLayoutStore,
  { datasetKey, scopeKey, filterKey }: LayoutWorkspaceKey,
): TopologyLayoutSnapshot | null {
  return store[datasetKey]?.[scopeKey]?.[filterKey] ?? null;
}

export function setTopologyLayoutSnapshot(
  store: TopologyLayoutStore,
  { datasetKey, scopeKey, filterKey, snapshot }: LayoutWorkspaceKey & { snapshot: TopologyLayoutSnapshot },
): TopologyLayoutStore {
  return {
    ...store,
    [datasetKey]: {
      ...(store[datasetKey] ?? {}),
      [scopeKey]: {
        ...(store[datasetKey]?.[scopeKey] ?? {}),
        [filterKey]: snapshot,
      },
    },
  };
}

export function removeTopologyLayoutSnapshot(
  store: TopologyLayoutStore,
  { datasetKey, scopeKey, filterKey }: LayoutWorkspaceKey,
): TopologyLayoutStore {
  const nextStore = { ...store };
  const nextDataset = { ...(nextStore[datasetKey] ?? {}) };
  const nextScope = { ...(nextDataset[scopeKey] ?? {}) };
  delete nextScope[filterKey];
  if (Object.keys(nextScope).length === 0) {
    delete nextDataset[scopeKey];
  } else {
    nextDataset[scopeKey] = nextScope;
  }
  if (Object.keys(nextDataset).length === 0) {
    delete nextStore[datasetKey];
  } else {
    nextStore[datasetKey] = nextDataset;
  }
  return nextStore;
}

export function clearTopologyScopeLayouts(
  store: TopologyLayoutStore,
  { datasetKey, scopeKey }: Pick<LayoutWorkspaceKey, 'datasetKey' | 'scopeKey'>,
): TopologyLayoutStore {
  const nextStore = { ...store };
  const nextDataset = { ...(nextStore[datasetKey] ?? {}) };
  delete nextDataset[scopeKey];
  if (Object.keys(nextDataset).length === 0) {
    delete nextStore[datasetKey];
  } else {
    nextStore[datasetKey] = nextDataset;
  }
  return nextStore;
}

export function applyManualLayoutSnapshot({
  nodes,
  snapshot,
}: {
  nodes: SignalGraphNode[];
  snapshot: TopologyLayoutSnapshot | null;
}): {
  nodes: SignalGraphNode[];
  cleanedSnapshot: TopologyLayoutSnapshot;
} {
  const manualPositions: Record<string, TopologyNodePosition> = {};
  const mergedNodes = nodes.map((node) => {
    const position = snapshot?.manualPositions[node.id] ?? node.position;
    manualPositions[node.id] = position;
    return {
      ...node,
      position,
    };
  });

  return {
    nodes: mergedNodes,
    cleanedSnapshot: {
      manualPositions,
      viewport: snapshot?.viewport,
      updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString(),
    },
  };
}

export function buildAutoFlowLayout(nodes: SignalGraphNode[]): SignalGraphNode[] {
  return [...nodes];
}

export function buildManualLayoutSnapshot({
  nodes,
  viewport,
}: {
  nodes: Array<{ id: string; position: TopologyNodePosition }>;
  viewport?: TopologyViewport;
}): TopologyLayoutSnapshot {
  return {
    manualPositions: nodes.reduce<Record<string, TopologyNodePosition>>((acc, node) => {
      acc[node.id] = node.position;
      return acc;
    }, {}),
    viewport,
    updatedAt: new Date().toISOString(),
  };
}
