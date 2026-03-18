import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { VisibleTaskGraph } from '@/lib/task/task-dag-visibility';
import type { TaskNode } from '@/lib/types/task';
import { layoutDagNodes, type ResolvedDagDirection } from './task-dag-layout';

export const TASK_DAG_NODE_WIDTH = 256;
export const TASK_DAG_NODE_HEIGHT = 140;

const COLUMN_GAP = 320;
const ROW_GAP = 180;

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
  isSelected: boolean;
  isSearchMatch: boolean;
  isSearchDimmed: boolean;
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
export type TaskDagFlowEdge = Edge;

export interface BuildTaskDagFlowOptions {
  selectedTaskId?: string | null;
  searchMatchedTaskIds?: ReadonlySet<string>;
  hasActiveSearch?: boolean;
  direction?: ResolvedDagDirection;
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
): Map<string, { x: number; y: number }> {
  const fallbackPositions = buildFallbackPositions(orderedNodeIds, edges);

  try {
    const layoutPositions = layoutDagNodes(
      orderedNodeIds.map((id) => ({ id })),
      edges,
      direction,
    );
    if (layoutPositions.size > 0) {
      return layoutPositions;
    }
  } catch {
    // Fall back to the old depth-based layout when dagre fails.
  }

  return fallbackPositions;
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

function buildEdges(edges: Array<{ id: string; source: string; target: string; type: 'hard' | 'soft' }>): TaskDagFlowEdge[] {
  return edges.map((edge) => {
    const hardEdge = edge.type === 'hard';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'default',
      animated: false,
      selectable: false,
      style: hardEdge
        ? { stroke: '#C75B3A', strokeWidth: 2.25 }
        : { stroke: '#78716C', strokeWidth: 1.75, strokeDasharray: '7 5' },
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
  const positions = resolveNodePositions(graph.topologicalOrder, graph.edges, direction);
  const handlePositions = resolveHandlePositions(direction);

  const nodes = graph.topologicalOrder
    .map((taskId) => nodeById.get(taskId))
    .filter((node): node is TaskGraph['nodes'][number] => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: 'taskDag',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
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

  return { nodes, edges: buildEdges(graph.edges) };
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
  const nodeById = new Map(visibleGraph.nodes.map((node) => [node.id, node]));
  const topologicalOrder = visibleGraph.nodes.map((node) => node.id);
  const positions = resolveNodePositions(topologicalOrder, visibleGraph.edges, direction);
  const handlePositions = resolveHandlePositions(direction);

  const nodes = topologicalOrder
    .map((taskId) => nodeById.get(taskId))
    .filter((node): node is VisibleTaskGraph['nodes'][number] => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: 'taskDag',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
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

  return { nodes, edges: buildEdges(visibleGraph.edges) };
}
