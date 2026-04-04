import type { TaskGraph, TaskGraphEdge } from '@/lib/task/task-dag-graph';
import type { VisibleTaskGraph, VisibleTaskGraphNode } from '@/lib/task/task-dag-visibility';

export interface TaskDagIntervalCollapseItem {
  startId: string
  endId: string
  collapsed: boolean
}

export interface TaskDagIntervalCollapseState {
  intervals: TaskDagIntervalCollapseItem[]
}

export interface ResolvedTaskDagInterval {
  startId: string
  endId: string
  nodeIds: string[]
  hiddenNodeIds: string[]
  memberCount: number
}

export type TaskDagIntervalResolveErrorReason =
  | 'same-node'
  | 'not-connected'
  | 'external-incoming'
  | 'external-outgoing'

export type TaskDagIntervalResolveResult =
  | ({
    ok: true
  } & ResolvedTaskDagInterval)
  | {
    ok: false
    reason: TaskDagIntervalResolveErrorReason
    message: string
  }

export type TaskDagIntervalValidationResult =
  | { ok: true }
  | { ok: false; reason: 'partial-overlap'; message: string }

export interface ResolvedTaskDagIntervalItem extends ResolvedTaskDagInterval {
  collapsed: boolean
}

export interface ProjectedTaskDagIntervalGraph {
  normalizedState: TaskDagIntervalCollapseState
  visibleGraph: VisibleTaskGraph
  intervalsByTerminalId: Map<string, ResolvedTaskDagIntervalItem[]>
  collapsedIntervalsByTerminalId: Map<string, ResolvedTaskDagIntervalItem[]>
}

export const EMPTY_TASK_DAG_INTERVAL_COLLAPSE_STATE: TaskDagIntervalCollapseState = {
  intervals: [],
}

function buildIncomingEdgesByTarget(graph: TaskGraph): Map<string, TaskGraphEdge[]> {
  const map = new Map<string, TaskGraphEdge[]>()
  for (const edge of graph.edges) {
    const list = map.get(edge.target)
    if (list) {
      list.push(edge)
    } else {
      map.set(edge.target, [edge])
    }
  }
  return map
}

function buildOutgoingEdgesBySource(graph: TaskGraph): Map<string, TaskGraphEdge[]> {
  const map = new Map<string, TaskGraphEdge[]>()
  for (const edge of graph.edges) {
    const list = map.get(edge.source)
    if (list) {
      list.push(edge)
    } else {
      map.set(edge.source, [edge])
    }
  }
  return map
}

function collectReachableNodeIds(
  startId: string,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
): Set<string> {
  const visited = new Set<string>([startId])
  const queue = [startId]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const edge of outgoingEdgesBySource.get(current) ?? []) {
      if (visited.has(edge.target)) {
        continue
      }
      visited.add(edge.target)
      queue.push(edge.target)
    }
  }

  return visited
}

function collectAncestorNodeIds(
  endId: string,
  incomingEdgesByTarget: Map<string, TaskGraphEdge[]>,
): Set<string> {
  const visited = new Set<string>([endId])
  const queue = [endId]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const edge of incomingEdgesByTarget.get(current) ?? []) {
      if (visited.has(edge.source)) {
        continue
      }
      visited.add(edge.source)
      queue.push(edge.source)
    }
  }

  return visited
}

function buildIntervalNodeIds(
  graph: TaskGraph,
  startId: string,
  endId: string,
  incomingEdgesByTarget: Map<string, TaskGraphEdge[]>,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
): string[] {
  const reachableFromStart = collectReachableNodeIds(startId, outgoingEdgesBySource)
  const ancestorsOfEnd = collectAncestorNodeIds(endId, incomingEdgesByTarget)

  return graph.topologicalOrder.filter((nodeId) => (
    reachableFromStart.has(nodeId) && ancestorsOfEnd.has(nodeId)
  ))
}

function determineOrderedEndpoints(
  graph: TaskGraph,
  leftId: string,
  rightId: string,
  outgoingEdgesBySource: Map<string, TaskGraphEdge[]>,
): {
  startId: string
  endId: string
} | null {
  if (leftId === rightId) {
    return null
  }

  const leftReachable = collectReachableNodeIds(leftId, outgoingEdgesBySource)
  if (leftReachable.has(rightId)) {
    return { startId: leftId, endId: rightId }
  }

  const rightReachable = collectReachableNodeIds(rightId, outgoingEdgesBySource)
  if (rightReachable.has(leftId)) {
    return { startId: rightId, endId: leftId }
  }

  const nodeIdSet = new Set(graph.topologicalOrder)
  if (!nodeIdSet.has(leftId) || !nodeIdSet.has(rightId)) {
    return null
  }

  return null
}

function resolveIntervalErrorMessage(reason: TaskDagIntervalResolveErrorReason): string {
  switch (reason) {
    case 'same-node':
      return '区间收缩需要两个不同的端点。'
    case 'not-connected':
      return '所选两个节点之间不存在可收缩的上下游区间。'
    case 'external-incoming':
      return '区间内部存在边界外上游依赖，当前不能收缩。'
    case 'external-outgoing':
      return '区间内部存在边界外下游依赖，当前不能收缩。'
    default:
      return '当前区间不满足收缩条件。'
  }
}

export function resolveTaskDagIntervalDefinition(
  graph: TaskGraph,
  leftId: string,
  rightId: string,
): TaskDagIntervalResolveResult {
  if (leftId === rightId) {
    return {
      ok: false,
      reason: 'same-node',
      message: resolveIntervalErrorMessage('same-node'),
    }
  }

  const incomingEdgesByTarget = buildIncomingEdgesByTarget(graph)
  const outgoingEdgesBySource = buildOutgoingEdgesBySource(graph)
  const orderedEndpoints = determineOrderedEndpoints(graph, leftId, rightId, outgoingEdgesBySource)
  if (!orderedEndpoints) {
    return {
      ok: false,
      reason: 'not-connected',
      message: resolveIntervalErrorMessage('not-connected'),
    }
  }

  const { startId, endId } = orderedEndpoints
  const nodeIds = buildIntervalNodeIds(
    graph,
    startId,
    endId,
    incomingEdgesByTarget,
    outgoingEdgesBySource,
  )
  const nodeIdSet = new Set(nodeIds)
  if (!nodeIdSet.has(startId) || !nodeIdSet.has(endId) || nodeIds.length < 2) {
    return {
      ok: false,
      reason: 'not-connected',
      message: resolveIntervalErrorMessage('not-connected'),
    }
  }

  for (const nodeId of nodeIds) {
    for (const edge of incomingEdgesByTarget.get(nodeId) ?? []) {
      if (!nodeIdSet.has(edge.source) && nodeId !== startId) {
        return {
          ok: false,
          reason: 'external-incoming',
          message: resolveIntervalErrorMessage('external-incoming'),
        }
      }
    }

    for (const edge of outgoingEdgesBySource.get(nodeId) ?? []) {
      if (!nodeIdSet.has(edge.target) && nodeId !== endId) {
        return {
          ok: false,
          reason: 'external-outgoing',
          message: resolveIntervalErrorMessage('external-outgoing'),
        }
      }
    }
  }

  return {
    ok: true,
    startId,
    endId,
    nodeIds,
    hiddenNodeIds: nodeIds.filter((nodeId) => nodeId !== endId),
    memberCount: nodeIds.length,
  }
}

function countSetIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0
  for (const value of left) {
    if (right.has(value)) {
      count += 1
    }
  }
  return count
}

export function validateTaskDagIntervalAgainstExisting(
  definition: ResolvedTaskDagInterval | null,
  existingDefinitions: ResolvedTaskDagInterval[],
): TaskDagIntervalValidationResult {
  if (!definition) {
    return { ok: true }
  }

  const definitionSet = new Set(definition.nodeIds)
  for (const existingDefinition of existingDefinitions) {
    const existingSet = new Set(existingDefinition.nodeIds)
    const intersectionCount = countSetIntersection(definitionSet, existingSet)
    if (intersectionCount === 0) {
      continue
    }

    const definitionContainsExisting = existingDefinition.nodeIds.every((nodeId) => definitionSet.has(nodeId))
    const existingContainsDefinition = definition.nodeIds.every((nodeId) => existingSet.has(nodeId))
    if (definitionContainsExisting || existingContainsDefinition) {
      continue
    }

    return {
      ok: false,
      reason: 'partial-overlap',
      message: '区间收缩允许嵌套，但不允许部分重叠。',
    }
  }

  return { ok: true }
}

function normalizeTaskDagIntervalCollapseState(
  graph: TaskGraph,
  state: TaskDagIntervalCollapseState | undefined,
): {
  normalizedState: TaskDagIntervalCollapseState
  resolvedIntervals: ResolvedTaskDagIntervalItem[]
} {
  const intervals = Array.isArray(state?.intervals) ? state?.intervals : []
  const seenKeys = new Set<string>()
  const normalizedIntervals: TaskDagIntervalCollapseItem[] = []
  const resolvedIntervals: ResolvedTaskDagIntervalItem[] = []

  for (const interval of intervals) {
    const startId = typeof interval?.startId === 'string' ? interval.startId.trim() : ''
    const endId = typeof interval?.endId === 'string' ? interval.endId.trim() : ''
    if (!startId || !endId) {
      continue
    }

    const key = `${startId}\0${endId}`
    if (seenKeys.has(key)) {
      continue
    }

    const resolvedInterval = resolveTaskDagIntervalDefinition(graph, startId, endId)
    if (!resolvedInterval.ok) {
      continue
    }

    const overlapValidation = validateTaskDagIntervalAgainstExisting(resolvedInterval, resolvedIntervals)
    if (!overlapValidation.ok) {
      continue
    }

    seenKeys.add(key)
    const normalizedInterval = {
      startId,
      endId,
      collapsed: interval.collapsed !== false,
    }
    normalizedIntervals.push(normalizedInterval)
    resolvedIntervals.push({
      ...resolvedInterval,
      collapsed: normalizedInterval.collapsed,
    })
  }

  return {
    normalizedState: {
      intervals: normalizedIntervals,
    },
    resolvedIntervals,
  }
}

function rebuildVisibleGraph(
  baseVisibleGraph: VisibleTaskGraph,
  visibleNodes: VisibleTaskGraphNode[],
  visibleEdges: TaskGraphEdge[],
  hiddenNodeIds: string[],
): VisibleTaskGraph {
  const incomingCount = new Map(visibleNodes.map((node) => [node.id, 0]))
  for (const edge of visibleEdges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
  }

  const visibleRootNodeIds = visibleNodes
    .map((node) => node.id)
    .filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0)

  let visibleCurrentRootNodeId: string | null = null
  if (baseVisibleGraph.sourceCurrentRootNodeId !== null) {
    for (const nodeId of visibleRootNodeIds) {
      const node = visibleNodes.find((candidate) => candidate.id === nodeId)
      if (node && node.status !== 'completed' && node.status !== 'cancelled') {
        visibleCurrentRootNodeId = nodeId
        break
      }
    }
  }

  return {
    ...baseVisibleGraph,
    nodes: visibleNodes,
    edges: visibleEdges,
    hiddenNodeIds,
    visibleRootNodeIds,
    visibleCurrentRootNodeId,
  }
}

export function projectVisibleTaskGraphWithIntervalCollapses(
  graph: TaskGraph,
  baseVisibleGraph: VisibleTaskGraph,
  state: TaskDagIntervalCollapseState = EMPTY_TASK_DAG_INTERVAL_COLLAPSE_STATE,
): ProjectedTaskDagIntervalGraph {
  const { normalizedState, resolvedIntervals } = normalizeTaskDagIntervalCollapseState(graph, state)
  const baseVisibleNodeIds = new Set(baseVisibleGraph.nodes.map((node) => node.id))
  const applicableIntervals = resolvedIntervals.filter((interval) => (
    interval.nodeIds.every((nodeId) => baseVisibleNodeIds.has(nodeId))
  ))
  const hiddenNodeIdSet = new Set(baseVisibleGraph.hiddenNodeIds)
  const visibleNodeIdSet = new Set(baseVisibleNodeIds)
  const collapsedIntervalsByTerminalId = new Map<string, ResolvedTaskDagIntervalItem[]>()
  const intervalsByTerminalId = new Map<string, ResolvedTaskDagIntervalItem[]>()

  for (const interval of applicableIntervals) {
    const terminalIntervals = intervalsByTerminalId.get(interval.endId)
    if (terminalIntervals) {
      terminalIntervals.push(interval)
    } else {
      intervalsByTerminalId.set(interval.endId, [interval])
    }

    if (!interval.collapsed) {
      continue
    }

    for (const hiddenNodeId of interval.hiddenNodeIds) {
      hiddenNodeIdSet.add(hiddenNodeId)
      visibleNodeIdSet.delete(hiddenNodeId)
    }

    const collapsedIntervals = collapsedIntervalsByTerminalId.get(interval.endId)
    if (collapsedIntervals) {
      collapsedIntervals.push(interval)
    } else {
      collapsedIntervalsByTerminalId.set(interval.endId, [interval])
    }
  }

  const visibleEdgeByKey = new Map<string, TaskGraphEdge>()
  const addVisibleEdge = (edge: TaskGraphEdge) => {
    if (!visibleNodeIdSet.has(edge.source) || !visibleNodeIdSet.has(edge.target)) {
      return
    }

    const key = `${edge.source}|${edge.target}|${edge.type}`
    if (!visibleEdgeByKey.has(key)) {
      visibleEdgeByKey.set(key, edge)
    }
  }

  for (const edge of baseVisibleGraph.edges) {
    addVisibleEdge(edge)
  }

  for (const interval of applicableIntervals.filter((candidate) => candidate.collapsed)) {
    const intervalNodeIdSet = new Set(interval.nodeIds)
    for (const edge of baseVisibleGraph.edges) {
      if (edge.target !== interval.startId || intervalNodeIdSet.has(edge.source)) {
        continue
      }

      addVisibleEdge({
        id: `edge:${edge.source}->${interval.endId}:${edge.type}:interval-collapse:${interval.startId}->${interval.endId}`,
        source: edge.source,
        target: interval.endId,
        type: edge.type,
      })
    }
  }

  const visibleNodes = baseVisibleGraph.nodes.filter((node) => visibleNodeIdSet.has(node.id))
  const hiddenNodeIds = graph.topologicalOrder.filter((nodeId) => hiddenNodeIdSet.has(nodeId))
  const visibleEdges = graph.topologicalOrder.flatMap((sourceId) => (
    [...visibleEdgeByKey.values()].filter((edge) => edge.source === sourceId)
  ))

  return {
    normalizedState,
    visibleGraph: rebuildVisibleGraph(baseVisibleGraph, visibleNodes, visibleEdges, hiddenNodeIds),
    intervalsByTerminalId,
    collapsedIntervalsByTerminalId,
  }
}
