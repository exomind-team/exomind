import type { TaskNode } from '@/lib/types/task'

export interface TaskGraphNode {
  id: string
  title: string
  status: TaskNode['status']
  priority: TaskNode['priority']
  isRoot: boolean
  isCompleted: boolean
  isExecutable: boolean
  isBlocked: boolean
}

export interface TaskGraphEdge {
  id: string
  source: string
  target: string
  type: 'soft' | 'hard'
}

export interface TaskGraph {
  nodes: TaskGraphNode[]
  edges: TaskGraphEdge[]
  rootNodeIds: string[]
  currentRootNodeId: string | null
  topologicalOrder: string[]
  hasCycle: boolean
}

function compareTasksForGraphOrder(left: TaskNode, right: TaskNode): number {
  const createdDiff = left.createdAt - right.createdAt
  if (createdDiff !== 0) return createdDiff

  const updatedDiff = left.updatedAt - right.updatedAt
  if (updatedDiff !== 0) return updatedDiff

  return left.id.localeCompare(right.id)
}

function isTerminalStatus(status: TaskNode['status']): boolean {
  return status === 'completed' || status === 'abandoned'
}

function isDependencyBlocking(task: TaskNode, taskById: Map<string, TaskNode>): boolean {
  if (isTerminalStatus(task.status)) {
    return false
  }

  return task.dependsOn.some((dependency) => {
    const predecessor = taskById.get(dependency.taskId)
    if (!predecessor) {
      return false
    }

    if (dependency.type === 'hard') {
      return predecessor.status !== 'completed'
    }

    return predecessor.status === 'not_started'
  })
}

function isTaskExecutable(task: TaskNode, taskById: Map<string, TaskNode>): boolean {
  if (task.status !== 'not_started') {
    return false
  }

  return !task.dependsOn.some((dependency) => {
    if (dependency.type !== 'hard') {
      return false
    }

    const predecessor = taskById.get(dependency.taskId)
    if (!predecessor) {
      return false
    }

    return predecessor.status !== 'completed'
  })
}

export function resolveCurrentRootNodeId({
  rootNodeIds,
  topologicalOrder,
  taskById,
}: {
  rootNodeIds: string[]
  topologicalOrder: string[]
  taskById: Map<string, TaskNode>
}): string | null {
  const rootNodeIdSet = new Set(rootNodeIds)

  for (const taskId of topologicalOrder) {
    if (!rootNodeIdSet.has(taskId)) {
      continue
    }

    const task = taskById.get(taskId)
    if (task && !isTerminalStatus(task.status)) {
      return taskId
    }
  }

  return null
}

export function buildTaskGraph(tasks: TaskNode[]): TaskGraph {
  const stableTasks = [...tasks].sort(compareTasksForGraphOrder)
  const taskById = new Map(stableTasks.map((task) => [task.id, task]))
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const edgeById = new Map<string, TaskGraphEdge>()

  for (const task of stableTasks) {
    indegree.set(task.id, 0)
    adjacency.set(task.id, [])
  }

  for (const task of stableTasks) {
    for (const dependency of task.dependsOn) {
      const predecessor = taskById.get(dependency.taskId)
      if (!predecessor) {
        continue
      }

      const edgeId = `edge:${predecessor.id}->${task.id}:${dependency.type}`
      if (edgeById.has(edgeId)) {
        continue
      }

      edgeById.set(edgeId, {
        id: edgeId,
        source: predecessor.id,
        target: task.id,
        type: dependency.type,
      })

      adjacency.get(predecessor.id)?.push(task.id)
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1)
    }
  }

  const compareTaskIds = (leftId: string, rightId: string): number => {
    const leftTask = taskById.get(leftId)
    const rightTask = taskById.get(rightId)

    if (!leftTask || !rightTask) {
      return leftId.localeCompare(rightId)
    }

    return compareTasksForGraphOrder(leftTask, rightTask)
  }

  for (const nodeIds of adjacency.values()) {
    nodeIds.sort(compareTaskIds)
  }

  const pendingIndegree = new Map(indegree)
  const available = stableTasks
    .filter((task) => (pendingIndegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)

  const topologicalOrder: string[] = []

  while (available.length > 0) {
    available.sort(compareTaskIds)
    const currentTaskId = available.shift()

    if (!currentTaskId) {
      break
    }

    topologicalOrder.push(currentTaskId)

    for (const nextTaskId of adjacency.get(currentTaskId) ?? []) {
      const nextIndegree = (pendingIndegree.get(nextTaskId) ?? 0) - 1
      pendingIndegree.set(nextTaskId, nextIndegree)
      if (nextIndegree === 0) {
        available.push(nextTaskId)
      }
    }
  }

  const hasCycle = topologicalOrder.length < stableTasks.length

  if (hasCycle) {
    const remaining = stableTasks
      .map((task) => task.id)
      .filter((taskId) => !topologicalOrder.includes(taskId))
      .sort(compareTaskIds)
    topologicalOrder.push(...remaining)
  }

  const rootNodeIds = topologicalOrder.filter((taskId) => (indegree.get(taskId) ?? 0) === 0)
  const topologicalIndex = new Map(topologicalOrder.map((taskId, index) => [taskId, index]))
  const rootNodeIdSet = new Set(rootNodeIds)

  const nodes = topologicalOrder
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskNode => Boolean(task))
    .map((task) => {
      const isBlocked = isDependencyBlocking(task, taskById)
      const isExecutable = isTaskExecutable(task, taskById)

      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        isRoot: rootNodeIdSet.has(task.id),
        isCompleted: task.status === 'completed',
        isExecutable,
        isBlocked,
      }
    })

  const edges = Array.from(edgeById.values()).sort((left, right) => {
    const sourceDiff = (topologicalIndex.get(left.source) ?? Number.MAX_SAFE_INTEGER)
      - (topologicalIndex.get(right.source) ?? Number.MAX_SAFE_INTEGER)
    if (sourceDiff !== 0) return sourceDiff

    const targetDiff = (topologicalIndex.get(left.target) ?? Number.MAX_SAFE_INTEGER)
      - (topologicalIndex.get(right.target) ?? Number.MAX_SAFE_INTEGER)
    if (targetDiff !== 0) return targetDiff

    const typeDiff = left.type.localeCompare(right.type)
    if (typeDiff !== 0) return typeDiff

    return left.id.localeCompare(right.id)
  })

  return {
    nodes,
    edges,
    rootNodeIds,
    currentRootNodeId: resolveCurrentRootNodeId({
      rootNodeIds,
      topologicalOrder,
      taskById,
    }),
    topologicalOrder,
    hasCycle,
  }
}
