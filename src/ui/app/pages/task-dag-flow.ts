import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { VisibleTaskGraph } from '@/lib/task/task-dag-visibility';
import type { TaskNode } from '@/lib/types/task';
import {
  buildDagLayoutEdgeKey,
  layoutDagNodes,
  type DagLayoutPoint,
  type ResolvedDagDirection,
} from './task-dag-layout';
import type { TaskDagManualLayoutSnapshot } from './task-dag-layout-store';

export const TASK_DAG_NODE_WIDTH = 160;
export const TASK_DAG_NODE_HEIGHT = 160;

const COLUMN_GAP = 220;
const ROW_GAP = 220;

const STATUS_LABEL: Record<TaskNode['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

const PRIORITY_LABEL: Record<TaskNode['priority'], string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
};

function resolveExecutionLabel(node: TaskGraph['nodes'][number]): string {
  if (node.status === 'completed') return '已完成';
  if (node.status === 'cancelled') return '已取消';
  if (node.status === 'in_progress') return '进行中';
  if (node.status === 'suspended') return '已挂起';
  if (node.isBlocked) return '受阻';
  if (node.isExecutable) return '可执行';
  return '待处理';
}

export type TaskDagFlowNodeData = {
  title: string;
  statusLabel: string;
  priorityLabel: string;
  executionLabel: string;
  intervalCollapseSummaries?: Array<{
    startId: string;
    startTitle: string;
    memberCount: number;
    collapsed: boolean;
  }>;
  isSelected: boolean;
  isSearchMatch: boolean;
  isSearchDimmed: boolean;
  isFocusDimmed: boolean;
  isFocusAnchor: boolean;
  isSecondaryNode: boolean;
  isCurrentRoot: boolean;
  isCollapsedTarget: boolean;
  isCollapsedUpstreamTarget: boolean;
  isCollapsedDownstreamTarget: boolean;
  isBlocked: boolean;
  isExecutable: boolean;
  blockedReason?: string | null;
  showConnectHandles?: boolean;
  connectPreviewType?: 'hard' | 'soft' | null;
  executeState?: 'active' | 'executable' | 'blocked' | 'terminal';
  hiddenUpstreamCount: number;
  hiddenDownstreamCount: number;
};

export type TaskDagFlowNode = Node<TaskDagFlowNodeData, 'taskDag'>;
export type TaskDagFlowEdgeData = {
  points?: DagLayoutPoint[] | null;
  hardEdge?: boolean;
  isFocusDimmed?: boolean;
};

export type TaskDagFlowEdge = Edge<TaskDagFlowEdgeData>;

export interface BuildTaskDagFlowOptions {
  selectedTaskId?: string | null;
  searchMatchedTaskIds?: ReadonlySet<string>;
  hasActiveSearch?: boolean;
  direction?: ResolvedDagDirection;
  manualPositions?: TaskDagManualLayoutSnapshot['manualPositions'] | null;
  focusedSeriesNodeIds?: ReadonlySet<string>;
  secondaryNodeIds?: ReadonlySet<string>;
}

function overlayManualPositions(
  nodePositions: Map<string, { x: number; y: number }>,
  orderedNodeIds: string[],
  manualPositions: TaskDagManualLayoutSnapshot['manualPositions'] | null | undefined,
): Map<string, { x: number; y: number }> {
  if (!manualPositions) {
    return nodePositions;
  }

  const validNodeIds = new Set(orderedNodeIds);
  const mergedPositions = new Map(nodePositions);
  for (const [nodeId, position] of Object.entries(manualPositions)) {
    if (!validNodeIds.has(nodeId)) {
      continue;
    }
    mergedPositions.set(nodeId, {
      x: position.x,
      y: position.y,
    });
  }

  return mergedPositions;
}

function buildFallbackPositions(
  orderedNodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const incomingByTarget = new Map<string, string[]>();
  const depthById = new Map<string, number>();
  const rowsByDepth = new Map<number, string[]>();

  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge.source);
    incomingByTarget.set(edge.target, incoming);
  }

  for (const taskId of orderedNodeIds) {
    const incomingDepths = (incomingByTarget.get(taskId) ?? [])
      .map((sourceId) => depthById.get(sourceId))
      .filter((depth): depth is number => depth !== undefined);
    const depth = incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : 0;
    depthById.set(taskId, depth);
    const rows = rowsByDepth.get(depth) ?? [];
    rows.push(taskId);
    rowsByDepth.set(depth, rows);
  }

  return new Map(orderedNodeIds.map((taskId) => {
    const depth = depthById.get(taskId) ?? 0;
    const row = rowsByDepth.get(depth)?.indexOf(taskId) ?? 0;
    return [taskId, { x: depth * COLUMN_GAP, y: row * ROW_GAP }] as const;
  }));
}

function resolveNodePositions(
  orderedNodeIds: string[],
  edges: Array<{ source: string; target: string }>,
  direction: ResolvedDagDirection,
  manualPositions?: TaskDagManualLayoutSnapshot['manualPositions'] | null,
): {
  nodePositions: Map<string, { x: number; y: number }>;
  edgePoints: Map<string, DagLayoutPoint[]>;
} {
  const fallbackPositions = buildFallbackPositions(orderedNodeIds, edges);

  try {
    const layoutResult = layoutDagNodes(
      orderedNodeIds.map((id) => ({ id })),
      edges,
      direction,
    );
    if (layoutResult.nodePositions.size > 0) {
      return {
        nodePositions: overlayManualPositions(layoutResult.nodePositions, orderedNodeIds, manualPositions),
        edgePoints: layoutResult.edgePoints,
      };
    }
  } catch {
    // Fall back to the old depth-based layout when dagre fails.
  }

  return {
    nodePositions: overlayManualPositions(fallbackPositions, orderedNodeIds, manualPositions),
    edgePoints: new Map<string, DagLayoutPoint[]>(),
  };
}

function resolveHandlePositions(direction: ResolvedDagDirection): {
  sourcePosition: Position;
  targetPosition: Position;
} {
  if (direction === 'TB') {
    return {
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  }

  return {
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };
}

function buildEdges(
  edges: Array<{ id: string; source: string; target: string; type: 'hard' | 'soft' }>,
  edgePoints: Map<string, DagLayoutPoint[]>,
  focusedSeriesNodeIds?: ReadonlySet<string>,
): TaskDagFlowEdge[] {
  const hasFocusedSeries = Boolean(focusedSeriesNodeIds && focusedSeriesNodeIds.size > 0);
  return edges.map((edge) => {
    const hardEdge = edge.type === 'hard';
    const isFocusDimmed = hasFocusedSeries
      ? !focusedSeriesNodeIds?.has(edge.source) || !focusedSeriesNodeIds?.has(edge.target)
      : false;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'dagreRouted',
      data: {
        points: edgePoints.get(buildDagLayoutEdgeKey(edge.source, edge.target)) ?? null,
        hardEdge,
        isFocusDimmed,
      },
      animated: false,
      selectable: false,
      style: hardEdge
        ? { stroke: '#C75B3A', strokeWidth: 2.25, opacity: isFocusDimmed ? 0.28 : 1 }
        : { stroke: '#78716C', strokeWidth: 1.75, strokeDasharray: '7 5', opacity: isFocusDimmed ? 0.28 : 1 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: hardEdge ? '#C75B3A' : '#78716C',
      },
    } satisfies TaskDagFlowEdge;
  });
}

export function buildTaskDagFlow(
  graph: TaskGraph,
  options: BuildTaskDagFlowOptions = {},
): {
  nodes: TaskDagFlowNode[];
  edges: TaskDagFlowEdge[];
} {
  const direction = options.direction ?? 'LR';
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const resolvedPositions = resolveNodePositions(
    graph.topologicalOrder,
    graph.edges,
    direction,
    options.manualPositions,
  );
  const handlePositions = resolveHandlePositions(direction);

  const nodes = graph.topologicalOrder
    .map((taskId) => nodeById.get(taskId))
    .filter((node): node is TaskGraph['nodes'][number] => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: 'taskDag',
      position: resolvedPositions.nodePositions.get(node.id) ?? { x: 0, y: 0 },
      sourcePosition: handlePositions.sourcePosition,
      targetPosition: handlePositions.targetPosition,
      draggable: false,
      data: {
        title: node.title,
        statusLabel: STATUS_LABEL[node.status],
        priorityLabel: PRIORITY_LABEL[node.priority],
        executionLabel: resolveExecutionLabel(node),
        isSelected: false,
        isSearchMatch: false,
        isSearchDimmed: false,
        isFocusDimmed: false,
        isFocusAnchor: false,
        isSecondaryNode: false,
        isCurrentRoot: node.id === graph.currentRootNodeId,
        isCollapsedTarget: false,
        isCollapsedUpstreamTarget: false,
        isCollapsedDownstreamTarget: false,
        isBlocked: node.isBlocked,
        isExecutable: node.isExecutable,
        blockedReason: null,
        showConnectHandles: false,
        connectPreviewType: null,
        executeState: undefined,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
      },
    } satisfies TaskDagFlowNode));

  return { nodes, edges: buildEdges(graph.edges, resolvedPositions.edgePoints, options.focusedSeriesNodeIds) };
}

export function buildVisibleTaskDagFlow(
  visibleGraph: VisibleTaskGraph,
  options: BuildTaskDagFlowOptions = {},
): {
  nodes: TaskDagFlowNode[];
  edges: TaskDagFlowEdge[];
} {
  const selectedTaskId = options.selectedTaskId ?? null;
  const searchMatchedTaskIds = options.searchMatchedTaskIds ?? new Set<string>();
  const hasActiveSearch = options.hasActiveSearch ?? false;
  const direction = options.direction ?? 'LR';
  const focusedSeriesNodeIds = options.focusedSeriesNodeIds;
  const hasFocusedSeries = Boolean(focusedSeriesNodeIds && focusedSeriesNodeIds.size > 0);
  const secondaryNodeIds = options.secondaryNodeIds;
  const nodeById = new Map(visibleGraph.nodes.map((node) => [node.id, node]));
  const topologicalOrder = visibleGraph.nodes.map((node) => node.id);
  const resolvedPositions = resolveNodePositions(
    topologicalOrder,
    visibleGraph.edges,
    direction,
    options.manualPositions,
  );
  const handlePositions = resolveHandlePositions(direction);

  const nodes = topologicalOrder
    .map((taskId) => nodeById.get(taskId))
    .filter((node): node is VisibleTaskGraph['nodes'][number] => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: 'taskDag',
      position: resolvedPositions.nodePositions.get(node.id) ?? { x: 0, y: 0 },
      sourcePosition: handlePositions.sourcePosition,
      targetPosition: handlePositions.targetPosition,
      draggable: false,
      data: {
        title: node.title,
        statusLabel: STATUS_LABEL[node.status],
        priorityLabel: PRIORITY_LABEL[node.priority],
        executionLabel: resolveExecutionLabel(node),
        isSelected: node.id === selectedTaskId,
        isSearchMatch: hasActiveSearch && searchMatchedTaskIds.has(node.id),
        isSearchDimmed: hasActiveSearch && !searchMatchedTaskIds.has(node.id),
        isFocusDimmed: hasFocusedSeries && !focusedSeriesNodeIds?.has(node.id),
        isFocusAnchor: false,
        isSecondaryNode: Boolean(secondaryNodeIds?.has(node.id)),
        isCurrentRoot: node.id === visibleGraph.visibleCurrentRootNodeId,
        isCollapsedTarget: node.isCollapsedTarget,
        isCollapsedUpstreamTarget: node.isCollapsedUpstreamTarget,
        isCollapsedDownstreamTarget: node.isCollapsedDownstreamTarget,
        isBlocked: node.isBlocked,
        isExecutable: node.isExecutable,
        blockedReason: null,
        showConnectHandles: false,
        connectPreviewType: null,
        executeState: undefined,
        hiddenUpstreamCount: node.hiddenUpstreamCount,
        hiddenDownstreamCount: node.hiddenDownstreamCount,
      },
    } satisfies TaskDagFlowNode));

  return {
    nodes,
    edges: buildEdges(visibleGraph.edges, resolvedPositions.edgePoints, focusedSeriesNodeIds),
  };
}
