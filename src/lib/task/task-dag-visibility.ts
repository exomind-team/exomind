import type { TaskGraph, TaskGraphEdge, TaskGraphNode } from '@/lib/task/task-dag-graph'

export interface TaskDagVisibilityState {
  collapsedUpstreamOf: string[]
}

export interface VisibleTaskGraphNode extends TaskGraphNode {
  hiddenUpstreamCount: number
  isCollapsedTarget: boolean
}

export interface VisibleTaskGraph {
  state: TaskDagVisibilityState
  nodes: VisibleTaskGraphNode[]
  edges: TaskGraphEdge[]
  hiddenNodeIds: string[]
  hasCycle: boolean
  visibleRootNodeIds: string[]
  visibleCurrentRootNodeId: string | null
  sourceRootNodeIds: string[]
  sourceCurrentRootNodeId: string | null
}

export const EMPTY_TASK_DAG_VISIBILITY_STATE: TaskDagVisibilityState = {
  collapsedUpstreamOf: [],
}

function isTerminalStatus(status: TaskGraphNode['status']): boolean {
  return status === 'completed' || status === 'abandoned'
}

function buildTopologicalIndex(graph: TaskGraph): Map<string, number> {
  return new Map(graph.topologicalOrder.map((nodeId, index) => [nodeId, index]))
}

function buildIncomingEdgeMap(graph: TaskGraph): Map<string, TaskGraphEdge[]> {
  const incomingEdgesByTarget = new Map<string, TaskGraphEdge[]>()

  for (const edge of graph.edges) {
    const incomingEdges = incomingEdgesByTarget.get(edge.target)
    if (incomingEdges) {
      incomingEdges.push(edge)
      continue
    }

    incomingEdgesByTarget.set(edge.target, [edge])
  }

  return incomingEdgesByTarget
}

function normalizeTaskDagVisibilityState(
  graph: TaskGraph,
  state: TaskDagVisibilityState | undefined,
): TaskDagVisibilityState {
  const topologicalIndex = buildTopologicalIndex(graph)
  const normalizedCollapsedUpstreamOf = Array.from(
    new Set((state?.collapsedUpstreamOf ?? []).filter((nodeId) => topologicalIndex.has(nodeId))),
  ).sort((leftNodeId, rightNodeId) => {
    const orderDiff = (topologicalIndex.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER)
      - (topologicalIndex.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER)
    if (orderDiff !== 0) return orderDiff

    return leftNodeId.localeCompare(rightNodeId)
  })

  return {
    collapsedUpstreamOf: normalizedCollapsedUpstreamOf,
  }
}

function collectUpstreamNodeIds(
  nodeId: string,
  incomingEdgesByTarget: Map<string, TaskGraphEdge[]>,
): Set<string> {
  const upstreamNodeIds = new Set<string>()
  const pendingNodeIds = (incomingEdgesByTarget.get(nodeId) ?? []).map((edge) => edge.source)

  while (pendingNodeIds.length > 0) {
    const currentNodeId = pendingNodeIds.pop()
    if (!currentNodeId || upstreamNodeIds.has(currentNodeId)) {
      continue
    }

    upstreamNodeIds.add(currentNodeId)

    for (const edge of incomingEdgesByTarget.get(currentNodeId) ?? []) {
      pendingNodeIds.push(edge.source)
    }
  }

  return upstreamNodeIds
}

export function projectVisibleTaskGraph(
  graph: TaskGraph,
  state: TaskDagVisibilityState = EMPTY_TASK_DAG_VISIBILITY_STATE,
): VisibleTaskGraph {
  const normalizedState = normalizeTaskDagVisibilityState(graph, state)
  const topologicalIndex = buildTopologicalIndex(graph)
  const incomingEdgesByTarget = buildIncomingEdgeMap(graph)
  const collapsedTargetIdSet = new Set(normalizedState.collapsedUpstreamOf)
  const hiddenNodeIdSet = new Set<string>()
  const upstreamNodeIdsByNodeId = new Map<string, Set<string>>()

  const getUpstreamNodeIds = (nodeId: string): Set<string> => {
    const cachedUpstreamNodeIds = upstreamNodeIdsByNodeId.get(nodeId)
    if (cachedUpstreamNodeIds) {
      return cachedUpstreamNodeIds
    }

    const upstreamNodeIds = collectUpstreamNodeIds(nodeId, incomingEdgesByTarget)
    upstreamNodeIdsByNodeId.set(nodeId, upstreamNodeIds)
    return upstreamNodeIds
  }

  for (const nodeId of normalizedState.collapsedUpstreamOf) {
    for (const upstreamNodeId of getUpstreamNodeIds(nodeId)) {
      if (collapsedTargetIdSet.has(upstreamNodeId)) {
        continue
      }

      hiddenNodeIdSet.add(upstreamNodeId)
    }
  }

  const hiddenNodeIds = graph.topologicalOrder.filter((nodeId) => hiddenNodeIdSet.has(nodeId))
  const visibleNodeIdSet = new Set(graph.topologicalOrder.filter((nodeId) => !hiddenNodeIdSet.has(nodeId)))

  const visibleEdges = graph.edges.filter((edge) => (
    visibleNodeIdSet.has(edge.source) && visibleNodeIdSet.has(edge.target)
  ))

  const visibleNodes = graph.nodes
    .filter((node) => visibleNodeIdSet.has(node.id))
    .map((node) => {
      let hiddenUpstreamCount = 0

      for (const upstreamNodeId of getUpstreamNodeIds(node.id)) {
        if (hiddenNodeIdSet.has(upstreamNodeId)) {
          hiddenUpstreamCount += 1
        }
      }

      return {
        ...node,
        hiddenUpstreamCount,
        isCollapsedTarget: collapsedTargetIdSet.has(node.id),
      }
    })
    .sort((leftNode, rightNode) => {
      const orderDiff = (topologicalIndex.get(leftNode.id) ?? Number.MAX_SAFE_INTEGER)
        - (topologicalIndex.get(rightNode.id) ?? Number.MAX_SAFE_INTEGER)
      if (orderDiff !== 0) return orderDiff

      return leftNode.id.localeCompare(rightNode.id)
    })

  const visibleIncomingCount = new Map(visibleNodes.map((node) => [node.id, 0]))
  for (const edge of visibleEdges) {
    visibleIncomingCount.set(edge.target, (visibleIncomingCount.get(edge.target) ?? 0) + 1)
  }

  const visibleRootNodeIds = visibleNodes
    .map((node) => node.id)
    .filter((nodeId) => (visibleIncomingCount.get(nodeId) ?? 0) === 0)

  const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]))
  let visibleCurrentRootNodeId: string | null = null
  if (graph.currentRootNodeId !== null) {
    for (const nodeId of visibleRootNodeIds) {
      const node = visibleNodeById.get(nodeId)
      if (node && !isTerminalStatus(node.status)) {
        visibleCurrentRootNodeId = nodeId
        break
      }
    }
  }

  return {
    state: normalizedState,
    nodes: visibleNodes,
    edges: visibleEdges,
    hiddenNodeIds,
    hasCycle: graph.hasCycle,
    visibleRootNodeIds,
    visibleCurrentRootNodeId,
    sourceRootNodeIds: [...graph.rootNodeIds],
    sourceCurrentRootNodeId: graph.currentRootNodeId,
  }
}
