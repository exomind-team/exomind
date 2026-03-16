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
  return status === 'completed' || status === 'cancelled'
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

/**
 * Build outgoing (children) edge map: nodeId → edges where nodeId is source.
 */
function buildOutgoingEdgeMap(graph: TaskGraph): Map<string, TaskGraphEdge[]> {
  const outgoing = new Map<string, TaskGraphEdge[]>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source)
    if (list) {
      list.push(edge)
    } else {
      outgoing.set(edge.source, [edge])
    }
  }
  return outgoing
}

/**
 * Collect ALL upstream ancestor IDs (for hiddenUpstreamCount display).
 * This is the simple transitive closure — no leak check.
 */
function collectAllUpstreamNodeIds(
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

/**
 * Calculate the safe collapsible upstream set using the no-leak constraint.
 *
 * Algorithm (from #424):
 * BFS upward from anchor. A candidate node is safe to collapse ONLY if
 * ALL its children (outgoing edges) point to nodes already in the collapsed set.
 * The anchor itself is exempt (it's allowed to have external outputs).
 *
 * Nested folding: when encountering a node that is itself a collapse target
 * for another fold, treat it as an atomic/opaque node — include it in the
 * collapsed set but do NOT expand its parents (they belong to that node's
 * own fold scope).
 */
function calculateSafeCollapseScope(
  anchorId: string,
  incomingEdgesByTarget: Map<string, TaskGraphEdge[]>,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
  otherCollapseTargets: Set<string>,
): Set<string> {
  const collapsedSet = new Set<string>([anchorId])
  const visited = new Set<string>([anchorId])
  const queue: string[] = (incomingEdgesByTarget.get(anchorId) ?? []).map((e) => e.source)

  while (queue.length > 0) {
    const candidate = queue.shift()!
    if (visited.has(candidate)) continue
    visited.add(candidate)

    // No-leak check: ALL children of candidate must be in collapsedSet
    const children = (outgoingEdgesBySource.get(candidate) ?? []).map((e) => e.target)
    const isSafe = children.every((child) => collapsedSet.has(child))

    if (isSafe) {
      collapsedSet.add(candidate)

      // Nested folding boundary: if this candidate is itself a collapse target,
      // treat it as atomic — don't expand its parents (they're its own fold scope).
      if (otherCollapseTargets.has(candidate)) {
        continue
      }

      // Continue exploring upstream
      for (const edge of incomingEdgesByTarget.get(candidate) ?? []) {
        if (!visited.has(edge.source)) {
          queue.push(edge.source)
        }
      }
    }
    // If not safe, skip — this blocks upstream exploration through this path
  }

  return collapsedSet
}

export function projectVisibleTaskGraph(
  graph: TaskGraph,
  state: TaskDagVisibilityState = EMPTY_TASK_DAG_VISIBILITY_STATE,
): VisibleTaskGraph {
  const normalizedState = normalizeTaskDagVisibilityState(graph, state)
  const topologicalIndex = buildTopologicalIndex(graph)
  const incomingEdgesByTarget = buildIncomingEdgeMap(graph)
  const outgoingEdgesBySource = buildOutgoingEdgeMap(graph)
  const collapsedTargetIdSet = new Set(normalizedState.collapsedUpstreamOf)
  const hiddenNodeIdSet = new Set<string>()
  const allUpstreamCache = new Map<string, Set<string>>()

  const getAllUpstreamNodeIds = (nodeId: string): Set<string> => {
    const cached = allUpstreamCache.get(nodeId)
    if (cached) return cached
    const result = collectAllUpstreamNodeIds(nodeId, incomingEdgesByTarget)
    allUpstreamCache.set(nodeId, result)
    return result
  }

  // For each collapse target, compute safe scope using no-leak algorithm (#424)
  for (const anchorId of normalizedState.collapsedUpstreamOf) {
    // Pass other collapse targets so nested folds are treated as atomic boundaries
    const otherTargets = new Set(normalizedState.collapsedUpstreamOf.filter((id) => id !== anchorId))
    const safeScope = calculateSafeCollapseScope(anchorId, incomingEdgesByTarget, outgoingEdgesBySource, otherTargets)
    for (const nodeId of safeScope) {
      if (nodeId !== anchorId && !collapsedTargetIdSet.has(nodeId)) {
        hiddenNodeIdSet.add(nodeId)
      }
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

      for (const upstreamNodeId of getAllUpstreamNodeIds(node.id)) {
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
