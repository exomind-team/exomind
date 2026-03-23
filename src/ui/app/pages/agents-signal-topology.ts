import type { TargetType, SignalRoute } from '@/lib/types/signal-pool';
import type { RuntimeAggregatedAgent } from '@/services/runtime-manager';
import {
  VOICE_INPUT_NODE_ID,
  VOICE_INPUT_NODE_LABEL,
  VOICE_INPUT_NODE_SUBTITLE,
  isVoiceTranscriptTopic,
} from '@/lib/constants/signal-topics';

export type SignalGraphNodeType = 'signal-input' | 'topic' | 'agent' | 'actor' | 'frontend' | 'remote';

export interface SignalRouteRow {
  id: string;
  topic: string;
  targetType: TargetType;
  targetRef: string;
  status: 'active' | 'inactive';
  hostLabel?: string;
}

export interface SignalGraphNode {
  id: string;
  type: SignalGraphNodeType;
  label: string;
  status: string;
  energyPhase?: string;
  isDormant?: boolean;
  energyRatio?: number;
  position: {
    x: number;
    y: number;
  };
}

export interface SignalGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  topic: string;
  targetType: TargetType;
  targetRef: string;
  active: boolean;
}

export interface SignalGraph {
  nodes: SignalGraphNode[];
  edges: SignalGraphEdge[];
}

function asRouteStatus(enabled: boolean): SignalRouteRow['status'] {
  return enabled ? 'active' : 'inactive';
}

function topicNodeId(topic: string): string {
  return `topic:${topic}`;
}

function targetNodeId(targetType: TargetType, targetRef: string): string {
  return `${targetType}:${targetRef}`;
}

function sortByRouteKey(left: SignalRoute, right: SignalRoute): number {
  return `${left.topic}:${left.target_type}:${left.target_ref}`.localeCompare(
    `${right.topic}:${right.target_type}:${right.target_ref}`
  );
}

export function buildSignalRouteRows(routes: SignalRoute[], hostLabel?: string): SignalRouteRow[] {
  return [...routes].sort(sortByRouteKey).map((route) => ({
    id: route.id,
    topic: route.topic,
    targetType: route.target_type,
    targetRef: route.target_ref,
    status: asRouteStatus(route.enabled),
    hostLabel,
  }));
}

function getAgentMetaMap(agents: RuntimeAggregatedAgent[]): Map<string, {
  status: string;
  energyPhase?: string;
  isDormant?: boolean;
  energyRatio?: number;
}> {
  const map = new Map<string, {
    status: string;
    energyPhase?: string;
    isDormant?: boolean;
    energyRatio?: number;
  }>();
  for (const agent of agents) {
    if (!map.has(agent.id)) {
      map.set(agent.id, {
        status: agent.status,
        energyPhase: agent.energy?.phase,
        isDormant: agent.energy?.is_dormant,
        energyRatio: agent.energy?.ratio,
      });
    }
  }
  return map;
}

function nodeTypeToColumn(type: SignalGraphNodeType): number {
  if (type === 'signal-input') return 0;
  if (type === 'topic') return 1;
  if (type === 'agent') return 2;
  if (type === 'actor') return 3;
  if (type === 'frontend') return 4;
  return 5;
}

function nodeTypeLabel(type: SignalGraphNodeType): string {
  if (type === 'signal-input') return 'signal input（信号输入）';
  if (type === 'topic') return 'signal topic（信号主题）';
  if (type === 'agent') return 'agent';
  if (type === 'actor') return 'actor';
  if (type === 'frontend') return 'frontend';
  return 'remote runtime（远端运行时）';
}

function getInputNodeForTopic(topic: string): Pick<SignalGraphNode, 'id' | 'type' | 'label' | 'status'> | null {
  if (isVoiceTranscriptTopic(topic)) {
    return {
      id: VOICE_INPUT_NODE_ID,
      type: 'signal-input',
      label: VOICE_INPUT_NODE_LABEL,
      status: VOICE_INPUT_NODE_SUBTITLE,
    };
  }

  return null;
}

export function buildSignalGraph(routes: SignalRoute[], agents: RuntimeAggregatedAgent[]): SignalGraph {
  const nextNodes = new Map<string, SignalGraphNode>();
  const nextEdges = new Map<string, SignalGraphEdge>();
  const metaByAgentId = getAgentMetaMap(agents);
  const rowByType = new Map<SignalGraphNodeType, number>([
    ['signal-input', 0],
    ['topic', 0],
    ['agent', 0],
    ['actor', 0],
    ['frontend', 0],
    ['remote', 0],
  ]);

  for (const route of routes) {
    const inputNode = getInputNodeForTopic(route.topic);
    if (inputNode && !nextNodes.has(inputNode.id)) {
      const row = rowByType.get('signal-input') ?? 0;
      nextNodes.set(inputNode.id, {
        ...inputNode,
        position: {
          x: 120 + nodeTypeToColumn('signal-input') * 240,
          y: 80 + row * 110,
        },
      });
      rowByType.set('signal-input', row + 1);
    }

    const fromNodeId = topicNodeId(route.topic);
    if (!nextNodes.has(fromNodeId)) {
      const row = rowByType.get('topic') ?? 0;
      nextNodes.set(fromNodeId, {
        id: fromNodeId,
        type: 'topic',
        label: route.topic,
        status: nodeTypeLabel('topic'),
        position: {
          x: 120 + nodeTypeToColumn('topic') * 240,
          y: 80 + row * 110,
        },
      });
      rowByType.set('topic', row + 1);
    }

    if (inputNode) {
      const inputEdgeId = `input-link:${route.topic}`;
      const previousInputEdge = nextEdges.get(inputEdgeId);
      nextEdges.set(inputEdgeId, {
        id: inputEdgeId,
        source: inputNode.id,
        target: fromNodeId,
        label: `${inputNode.label} → ${route.topic}`,
        topic: route.topic,
        targetType: 'frontend',
        targetRef: route.topic,
        active: Boolean(previousInputEdge?.active || route.enabled),
      });
    }

    const toNodeId = targetNodeId(route.target_type, route.target_ref);
    if (!nextNodes.has(toNodeId)) {
      const kind = route.target_type as SignalGraphNodeType;
      const row = rowByType.get(kind) ?? 0;
      const agentMeta = kind === 'agent' ? metaByAgentId.get(route.target_ref) : undefined;
      const status = kind === 'agent' ? (agentMeta?.status ?? 'unknown') : nodeTypeLabel(kind);
      nextNodes.set(toNodeId, {
        id: toNodeId,
        type: kind,
        label: route.target_ref,
        status,
        energyPhase: agentMeta?.energyPhase,
        isDormant: agentMeta?.isDormant,
        energyRatio: agentMeta?.energyRatio,
        position: {
          x: 120 + nodeTypeToColumn(kind) * 240,
          y: 80 + row * 110,
        },
      });
      rowByType.set(kind, row + 1);
    }

    const edgeId = `route:${route.id}`;
    nextEdges.set(edgeId, {
      id: edgeId,
      source: fromNodeId,
      target: toNodeId,
      label: `${route.topic} → ${route.target_ref}`,
      topic: route.topic,
      targetType: route.target_type,
      targetRef: route.target_ref,
      active: route.enabled,
    });
  }

  // Include standalone agents not targeted by any route
  for (const agent of agents) {
    const agentNodeId = targetNodeId('agent', agent.id);
    if (!nextNodes.has(agentNodeId)) {
      const row = rowByType.get('agent') ?? 0;
      const agentMeta = metaByAgentId.get(agent.id);
      nextNodes.set(agentNodeId, {
        id: agentNodeId,
        type: 'agent',
        label: agent.id,
        status: agentMeta?.status ?? 'unknown',
        energyPhase: agentMeta?.energyPhase,
        isDormant: agentMeta?.isDormant,
        energyRatio: agentMeta?.energyRatio,
        position: {
          x: 120 + nodeTypeToColumn('agent') * 240,
          y: 80 + row * 110,
        },
      });
      rowByType.set('agent', row + 1);
    }
  }

  return {
    nodes: Array.from(nextNodes.values()),
    edges: Array.from(nextEdges.values()),
  };
}
