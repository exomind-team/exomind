import type { TaskGraph, TaskGraphEdge, TaskGraphNode } from '@/lib/task/task-dag-graph'

export interface TaskDagVisibilityState {
  collapsedUpstreamOf: string[]
  collapsedDownstreamOf: string[]
}

export interface VisibleTaskGraphNode extends TaskGraphNode {
  hiddenUpstreamCount: number
  hiddenDownstreamCount: number
  isCollapsedUpstreamTarget: boolean
  isCollapsedDownstreamTarget: boolean
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
  collapsedDownstreamOf: [],
}

function buildVisibleGraphNeighborIdsByNodeId(
  visibleGraph: VisibleTaskGraph,
): Map<string, Set<string>> {
  const neighborIdsByNodeId = new Map<string, Set<string>>()
  for (const node of visibleGraph.nodes) {
    neighborIdsByNodeId.set(node.id, new Set())
  }

  for (const edge of visibleGraph.edges) {
    if (!neighborIdsByNodeId.has(edge.source) || !neighborIdsByNodeId.has(edge.target)) {
      continue
    }

    neighborIdsByNodeId.get(edge.source)?.add(edge.target)
    neighborIdsByNodeId.get(edge.target)?.add(edge.source)
  }

  return neighborIdsByNodeId
}

export function findVisibleTaskGraphConnectedComponentNodeIds(
  visibleGraph: VisibleTaskGraph,
  anchorId: string,
): Set<string> {
  const neighborIdsByNodeId = buildVisibleGraphNeighborIdsByNodeId(visibleGraph)
  if (!neighborIdsByNodeId.has(anchorId)) {
    return new Set()
  }

  const componentNodeIds = new Set<string>()
  const pendingNodeIds = [anchorId]

  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop()
    if (!nodeId || componentNodeIds.has(nodeId)) {
      continue
    }

    componentNodeIds.add(nodeId)
    for (const neighborNodeId of neighborIdsByNodeId.get(nodeId) ?? []) {
      if (!componentNodeIds.has(neighborNodeId)) {
        pendingNodeIds.push(neighborNodeId)
      }
    }
  }

  return componentNodeIds
}

export function classifyVisibleTaskGraphTerminalNodesForSmartMode(
  visibleGraph: VisibleTaskGraph,
): {
  hiddenNodeIds: Set<string>
  secondaryNodeIds: Set<string>
} {
  const nodeById = new Map(visibleGraph.nodes.map((node) => [node.id, node]))
  const visitedNodeIds = new Set<string>()
  const hiddenNodeIds = new Set<string>()
  const secondaryNodeIds = new Set<string>()

  for (const node of visibleGraph.nodes) {
    if (visitedNodeIds.has(node.id)) {
      continue
    }

    const componentNodeIds = findVisibleTaskGraphConnectedComponentNodeIds(visibleGraph, node.id)
    for (const componentNodeId of componentNodeIds) {
      visitedNodeIds.add(componentNodeId)
    }

    const componentNodes = [...componentNodeIds]
      .map((componentNodeId) => nodeById.get(componentNodeId))
      .filter((componentNode): componentNode is VisibleTaskGraphNode => Boolean(componentNode))
    const componentTerminalNodes = componentNodes.filter((componentNode) => isTerminalStatus(componentNode.status))
    if (componentTerminalNodes.length === 0) {
      continue
    }

    const hasUnfinishedNode = componentNodes.some((componentNode) => !isTerminalStatus(componentNode.status))
    const targetSet = hasUnfinishedNode ? secondaryNodeIds : hiddenNodeIds
    for (const terminalNode of componentTerminalNodes) {
      targetSet.add(terminalNode.id)
    }
  }

  return {
    hiddenNodeIds,
    secondaryNodeIds,
  }
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
  const sortNodeIds = (nodeIds: string[]) => Array.from(
    new Set(nodeIds.filter((nodeId) => topologicalIndex.has(nodeId))),
  ).sort((leftNodeId, rightNodeId) => {
    const orderDiff = (topologicalIndex.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER)
      - (topologicalIndex.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER)
    if (orderDiff !== 0) return orderDiff

    return leftNodeId.localeCompare(rightNodeId)
  })

  return {
    collapsedUpstreamOf: sortNodeIds(state?.collapsedUpstreamOf ?? []),
    collapsedDownstreamOf: sortNodeIds(state?.collapsedDownstreamOf ?? []),
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

function collectAllDownstreamNodeIds(
  nodeId: string,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
): Set<string> {
  const downstreamNodeIds = new Set<string>()
  const pendingNodeIds = (outgoingEdgesBySource.get(nodeId) ?? []).map((edge) => edge.target)

  while (pendingNodeIds.length > 0) {
    const currentNodeId = pendingNodeIds.pop()
    if (!currentNodeId || downstreamNodeIds.has(currentNodeId)) {
      continue
    }

    downstreamNodeIds.add(currentNodeId)

    for (const edge of outgoingEdgesBySource.get(currentNodeId) ?? []) {
      pendingNodeIds.push(edge.target)
    }
  }

  return downstreamNodeIds
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
function calculateSafeUpstreamCollapseScope(
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

function calculateSafeDownstreamCollapseScope(
  anchorId: string,
  incomingEdgesByTarget: Map<string, TaskGraphEdge[]>,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
  otherCollapseTargets: Set<string>,
): Set<string> {
  const collapsedSet = new Set<string>([anchorId])
  const visited = new Set<string>([anchorId])
  const queue: string[] = (outgoingEdgesBySource.get(anchorId) ?? []).map((e) => e.target)

  while (queue.length > 0) {
    const candidate = queue.shift()!
    if (visited.has(candidate)) continue
    visited.add(candidate)

    // No-contamination check: ALL parents of candidate must be in collapsedSet.
    const parents = (incomingEdgesByTarget.get(candidate) ?? []).map((e) => e.source)
    const isSafe = parents.every((parent) => collapsedSet.has(parent))

    if (isSafe) {
      collapsedSet.add(candidate)

      if (otherCollapseTargets.has(candidate)) {
        continue
      }

      for (const edge of outgoingEdgesBySource.get(candidate) ?? []) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }
  }

  return collapsedSet
}

export type TaskDagCollapseDirection = 'upstream' | 'downstream'

export function calculateTaskDagCollapseScope(
  graph: TaskGraph,
  state: TaskDagVisibilityState,
  direction: TaskDagCollapseDirection,
  anchorId: string,
): Set<string> {
  const normalizedState = normalizeTaskDagVisibilityState(graph, state)
  const topologicalIndex = buildTopologicalIndex(graph)
  if (!topologicalIndex.has(anchorId)) {
    return new Set()
  }

  const incomingEdgesByTarget = buildIncomingEdgeMap(graph)
  const outgoingEdgesBySource = buildOutgoingEdgeMap(graph)
  const otherCollapseTargets = new Set(
    [
      ...normalizedState.collapsedUpstreamOf,
      ...normalizedState.collapsedDownstreamOf,
    ].filter((nodeId) => nodeId !== anchorId),
  )

  if (direction === 'upstream') {
    return calculateSafeUpstreamCollapseScope(anchorId, incomingEdgesByTarget, outgoingEdgesBySource, otherCollapseTargets)
  }

  return calculateSafeDownstreamCollapseScope(anchorId, incomingEdgesByTarget, outgoingEdgesBySource, otherCollapseTargets)
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
  const collapsedDownstreamTargetIdSet = new Set(normalizedState.collapsedDownstreamOf)
  const collapsedTargetIdUnion = new Set([
    ...normalizedState.collapsedUpstreamOf,
    ...normalizedState.collapsedDownstreamOf,
  ])
  const hiddenNodeIdSet = new Set<string>()
  const hiddenNodeDownstreamOwnerById = new Map<string, string>()
  const allUpstreamCache = new Map<string, Set<string>>()
  const allDownstreamCache = new Map<string, Set<string>>()

  const getAllUpstreamNodeIds = (nodeId: string): Set<string> => {
    const cached = allUpstreamCache.get(nodeId)
    if (cached) return cached
    const result = collectAllUpstreamNodeIds(nodeId, incomingEdgesByTarget)
    allUpstreamCache.set(nodeId, result)
    return result
  }

  const getAllDownstreamNodeIds = (nodeId: string): Set<string> => {
    const cached = allDownstreamCache.get(nodeId)
    if (cached) return cached
    const result = collectAllDownstreamNodeIds(nodeId, outgoingEdgesBySource)
    allDownstreamCache.set(nodeId, result)
    return result
  }

  // For each collapse target, compute safe scope using no-leak algorithm (#424)
  for (const anchorId of normalizedState.collapsedUpstreamOf) {
    const safeScope = calculateTaskDagCollapseScope(graph, normalizedState, 'upstream', anchorId)
    for (const nodeId of safeScope) {
      // Hide all nodes in scope except the anchor itself.
      // Other collapse targets that fall within this scope ARE hidden
      // (nested folding: upstream fold target gets absorbed by downstream fold).
      if (nodeId !== anchorId) {
        hiddenNodeIdSet.add(nodeId)
      }
    }
  }

  for (const anchorId of normalizedState.collapsedDownstreamOf) {
    const safeScope = calculateTaskDagCollapseScope(graph, normalizedState, 'downstream', anchorId)
    for (const nodeId of safeScope) {
      if (nodeId !== anchorId) {
        hiddenNodeIdSet.add(nodeId)
        if (!hiddenNodeDownstreamOwnerById.has(nodeId)) {
          hiddenNodeDownstreamOwnerById.set(nodeId, anchorId)
        }
      }
    }
  }

  const hiddenNodeIds = graph.topologicalOrder.filter((nodeId) => hiddenNodeIdSet.has(nodeId))
  const visibleNodeIdSet = new Set(graph.topologicalOrder.filter((nodeId) => !hiddenNodeIdSet.has(nodeId)))
  const visibleEdgeByKey = new Map<string, TaskGraphEdge>()
  const addVisibleEdge = (edge: TaskGraphEdge) => {
    const key = `${edge.source}|${edge.target}|${edge.type}`
    if (!visibleEdgeByKey.has(key)) {
      visibleEdgeByKey.set(key, edge)
    }
  }

  for (const edge of graph.edges) {
    if (visibleNodeIdSet.has(edge.source) && visibleNodeIdSet.has(edge.target)) {
      addVisibleEdge(edge)
    }
  }

  for (const edge of graph.edges) {
    if (!hiddenNodeIdSet.has(edge.source) || !visibleNodeIdSet.has(edge.target)) {
      continue
    }

    const downstreamAnchorId = hiddenNodeDownstreamOwnerById.get(edge.source)
    if (!downstreamAnchorId || !visibleNodeIdSet.has(downstreamAnchorId) || downstreamAnchorId === edge.target) {
      continue
    }

    addVisibleEdge({
      id: `edge:${downstreamAnchorId}->${edge.target}:${edge.type}:collapsed-downstream`,
      source: downstreamAnchorId,
      target: edge.target,
      type: edge.type,
    })
  }

  const visibleEdges = graph.topologicalOrder.flatMap((sourceId) => (
    [...visibleEdgeByKey.values()].filter((edge) => edge.source === sourceId)
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

      let hiddenDownstreamCount = 0
      for (const downstreamNodeId of getAllDownstreamNodeIds(node.id)) {
        if (hiddenNodeIdSet.has(downstreamNodeId)) {
          hiddenDownstreamCount += 1
        }
      }

      return {
        ...node,
        hiddenUpstreamCount,
        hiddenDownstreamCount,
        isCollapsedUpstreamTarget: collapsedTargetIdSet.has(node.id),
        isCollapsedDownstreamTarget: collapsedDownstreamTargetIdSet.has(node.id),
        isCollapsedTarget: collapsedTargetIdUnion.has(node.id),
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
