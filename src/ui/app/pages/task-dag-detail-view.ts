import { buildTaskGraph, type TaskGraphEdge } from '@/lib/task/task-dag-graph';
import {
  projectVisibleTaskGraph,
  type TaskDagVisibilityState,
  type VisibleTaskGraphNode,
} from '@/lib/task/task-dag-visibility';
import type { TaskNode, TaskStatus } from '@/lib/types/task';

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const EDGE_TYPE_LABELS: Record<TaskGraphEdge['type'], string> = {
  soft: '软依赖',
  hard: '硬依赖',
};

export interface TaskDagDetailViewNode extends VisibleTaskGraphNode {
  statusLabel: string;
  upstreamNodeCount: number;
  canCollapseUpstream: boolean;
  isCurrentTask: boolean;
  isVisibleRoot: boolean;
  isVisibleCurrentRoot: boolean;
  isSourceRoot: boolean;
  isSourceCurrentRoot: boolean;
}

export interface TaskDagDetailViewEdge extends TaskGraphEdge {
  sourceTitle: string;
  targetTitle: string;
  typeLabel: string;
}

export interface TaskDagDetailView {
  state: TaskDagVisibilityState;
  nodes: TaskDagDetailViewNode[];
  edges: TaskDagDetailViewEdge[];
  totalNodeCount: number;
  visibleNodeCount: number;
  hiddenNodeCount: number;
  visibleRootNodeIds: string[];
  visibleCurrentRootNodeId: string | null;
  visibleCurrentRootTitle: string | null;
  sourceCurrentRootNodeId: string | null;
  sourceCurrentRootTitle: string | null;
  isSourceCurrentRootVisible: boolean;
}

function buildIncomingEdgeMap(tasks: TaskNode[]): Map<string, TaskNode['dependsOn']> {
  return new Map(tasks.map((task) => [task.id, task.dependsOn]));
}

function buildOutgoingEdgeMap(tasks: TaskNode[]): Map<string, string[]> {
  const outgoingEdges = new Map<string, string[]>();

  for (const task of tasks) {
    outgoingEdges.set(task.id, outgoingEdges.get(task.id) ?? []);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const nextTaskIds = outgoingEdges.get(dependency.taskId);
      if (nextTaskIds) {
        nextTaskIds.push(task.id);
        continue;
      }

      outgoingEdges.set(dependency.taskId, [task.id]);
    }
  }

  return outgoingEdges;
}

function collectRelatedTaskIds(currentTaskId: string, tasks: TaskNode[]): Set<string> {
  const taskIds = new Set(tasks.map((task) => task.id));
  if (!taskIds.has(currentTaskId)) {
    return new Set();
  }

  const incomingEdgeMap = buildIncomingEdgeMap(tasks);
  const outgoingEdgeMap = buildOutgoingEdgeMap(tasks);
  const relatedTaskIds = new Set<string>([currentTaskId]);
  const pendingTaskIds = [currentTaskId];

  while (pendingTaskIds.length > 0) {
    const taskId = pendingTaskIds.pop();
    if (!taskId) continue;

    for (const dependency of incomingEdgeMap.get(taskId) ?? []) {
      if (relatedTaskIds.has(dependency.taskId) || !taskIds.has(dependency.taskId)) {
        continue;
      }
      relatedTaskIds.add(dependency.taskId);
      pendingTaskIds.push(dependency.taskId);
    }

    for (const nextTaskId of outgoingEdgeMap.get(taskId) ?? []) {
      if (relatedTaskIds.has(nextTaskId) || !taskIds.has(nextTaskId)) {
        continue;
      }
      relatedTaskIds.add(nextTaskId);
      pendingTaskIds.push(nextTaskId);
    }
  }

  return relatedTaskIds;
}

function buildGraphIncomingEdgeMap(edges: TaskGraphEdge[]): Map<string, TaskGraphEdge[]> {
  const incomingEdgesByTarget = new Map<string, TaskGraphEdge[]>();

  for (const edge of edges) {
    const current = incomingEdgesByTarget.get(edge.target);
    if (current) {
      current.push(edge);
      continue;
    }
    incomingEdgesByTarget.set(edge.target, [edge]);
  }

  return incomingEdgesByTarget;
}

function collectUpstreamNodeIds(nodeId: string, incomingEdgesByTarget: Map<string, TaskGraphEdge[]>): Set<string> {
  const upstreamNodeIds = new Set<string>();
  const pendingNodeIds = (incomingEdgesByTarget.get(nodeId) ?? []).map((edge) => edge.source);

  while (pendingNodeIds.length > 0) {
    const currentNodeId = pendingNodeIds.pop();
    if (!currentNodeId || upstreamNodeIds.has(currentNodeId)) {
      continue;
    }

    upstreamNodeIds.add(currentNodeId);
    for (const edge of incomingEdgesByTarget.get(currentNodeId) ?? []) {
      pendingNodeIds.push(edge.source);
    }
  }

  return upstreamNodeIds;
}

export function buildTaskDagDetailView(
  currentTask: TaskNode,
  allTasks: TaskNode[],
  visibilityState: TaskDagVisibilityState,
): TaskDagDetailView | null {
  const relatedTaskIds = collectRelatedTaskIds(currentTask.id, allTasks);
  if (relatedTaskIds.size === 0) {
    return null;
  }

  const relatedTasks = allTasks.filter((task) => relatedTaskIds.has(task.id));
  const taskGraph = buildTaskGraph(relatedTasks);
  const visibleGraph = projectVisibleTaskGraph(taskGraph, visibilityState);
  const visibleNodeIdSet = new Set(visibleGraph.nodes.map((node) => node.id));
  const visibleRootNodeIdSet = new Set(visibleGraph.visibleRootNodeIds);
  const sourceRootNodeIdSet = new Set(visibleGraph.sourceRootNodeIds);
  const incomingEdgesByTarget = buildGraphIncomingEdgeMap(taskGraph.edges);
  const graphNodeById = new Map(taskGraph.nodes.map((node) => [node.id, node]));

  const nodes = visibleGraph.nodes.map((node) => {
    const upstreamNodeCount = collectUpstreamNodeIds(node.id, incomingEdgesByTarget).size;

    return {
      ...node,
      statusLabel: STATUS_LABELS[node.status],
      upstreamNodeCount,
      canCollapseUpstream: upstreamNodeCount > 0,
      isCurrentTask: node.id === currentTask.id,
      isVisibleRoot: visibleRootNodeIdSet.has(node.id),
      isVisibleCurrentRoot: node.id === visibleGraph.visibleCurrentRootNodeId,
      isSourceRoot: sourceRootNodeIdSet.has(node.id),
      isSourceCurrentRoot: node.id === visibleGraph.sourceCurrentRootNodeId,
    };
  });

  const edges = visibleGraph.edges.map((edge) => ({
    ...edge,
    sourceTitle: graphNodeById.get(edge.source)?.title ?? edge.source,
    targetTitle: graphNodeById.get(edge.target)?.title ?? edge.target,
    typeLabel: EDGE_TYPE_LABELS[edge.type],
  }));

  const visibleCurrentRootTitle = visibleGraph.visibleCurrentRootNodeId
    ? graphNodeById.get(visibleGraph.visibleCurrentRootNodeId)?.title ?? visibleGraph.visibleCurrentRootNodeId
    : null;
  const sourceCurrentRootTitle = visibleGraph.sourceCurrentRootNodeId
    ? graphNodeById.get(visibleGraph.sourceCurrentRootNodeId)?.title ?? visibleGraph.sourceCurrentRootNodeId
    : null;

  return {
    state: visibleGraph.state,
    nodes,
    edges,
    totalNodeCount: taskGraph.nodes.length,
    visibleNodeCount: visibleGraph.nodes.length,
    hiddenNodeCount: visibleGraph.hiddenNodeIds.length,
    visibleRootNodeIds: visibleGraph.visibleRootNodeIds,
    visibleCurrentRootNodeId: visibleGraph.visibleCurrentRootNodeId,
    visibleCurrentRootTitle,
    sourceCurrentRootNodeId: visibleGraph.sourceCurrentRootNodeId,
    sourceCurrentRootTitle,
    isSourceCurrentRootVisible: visibleGraph.sourceCurrentRootNodeId
      ? visibleNodeIdSet.has(visibleGraph.sourceCurrentRootNodeId)
      : false,
  };
}
