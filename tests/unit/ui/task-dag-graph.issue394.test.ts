import { describe, expect, it } from 'vitest'
import type { TaskNode } from '@/lib/types/task'
import { buildTaskGraph } from '@/lib/task/task-dag-graph'

function makeTask(overrides: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title'>): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildTaskGraph issue-394（任务 DAG 图基础层）', () => {
  it('builds a stable topological order for a simple chain', () => {
    const taskA = makeTask({ id: 'a', title: 'A', createdAt: 10, updatedAt: 10 })
    const taskB = makeTask({
      id: 'b',
      title: 'B',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    })
    const taskC = makeTask({
      id: 'c',
      title: 'C',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [{ taskId: 'b', type: 'hard' }],
    })

    const graph = buildTaskGraph([taskC, taskA, taskB])

    expect(graph.topologicalOrder).toEqual(['a', 'b', 'c'])
    expect(graph.rootNodeIds).toEqual(['a'])
    expect(graph.currentRootNodeId).toBe('a')
    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
  })

  it('identifies all roots and does not treat parentId as a DAG edge', () => {
    const rootA = makeTask({ id: 'a', title: 'Root A', createdAt: 10, updatedAt: 10 })
    const rootB = makeTask({ id: 'b', title: 'Root B', createdAt: 20, updatedAt: 20 })
    const childOnlyByParent = makeTask({
      id: 'c',
      title: 'Parent Child Only',
      createdAt: 30,
      updatedAt: 30,
      parentId: 'a',
    })
    const dependent = makeTask({
      id: 'd',
      title: 'Depends On A',
      createdAt: 40,
      updatedAt: 40,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    })

    const graph = buildTaskGraph([dependent, childOnlyByParent, rootB, rootA])

    expect(graph.rootNodeIds).toEqual(['a', 'b', 'c'])
    expect(graph.edges).toEqual([
      {
        id: 'edge:a->d:hard',
        source: 'a',
        target: 'd',
        type: 'hard',
      },
    ])
  })

  it('skips completed and cancelled roots when selecting the current root node', () => {
    const completedRoot = makeTask({
      id: 'done',
      title: 'Completed Root',
      status: 'completed',
      createdAt: 10,
      updatedAt: 10,
    })
    const cancelledRoot = makeTask({
      id: 'gone',
      title: 'Abandoned Root',
      status: 'cancelled',
      createdAt: 20,
      updatedAt: 20,
    })
    const activeRoot = makeTask({ id: 'live', title: 'Live Root', createdAt: 30, updatedAt: 30 })

    const graph = buildTaskGraph([activeRoot, cancelledRoot, completedRoot])

    expect(graph.rootNodeIds).toEqual(['done', 'gone', 'live'])
    expect(graph.currentRootNodeId).toBe('live')
  })

  it('selects an unblocked unfinished node even when all structural roots are terminal', () => {
    const completedRoot = makeTask({
      id: 'done',
      title: 'Completed Root',
      status: 'completed',
      createdAt: 10,
      updatedAt: 10,
    })
    const executableChild = makeTask({
      id: 'child',
      title: 'Executable Child',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'done', type: 'hard' }],
    })

    const graph = buildTaskGraph([executableChild, completedRoot])

    expect(graph.rootNodeIds).toEqual(['done'])
    expect(graph.currentRootCandidateNodeIds).toEqual(['child'])
    expect(graph.currentRootNodeId).toBe('child')
  })

  it('selects the first unfinished root by stable order when roots are parallel', () => {
    const firstRoot = makeTask({ id: 'alpha', title: 'Alpha', createdAt: 10, updatedAt: 90 })
    const secondRoot = makeTask({ id: 'beta', title: 'Beta', createdAt: 20, updatedAt: 40 })
    const blockedLeaf = makeTask({
      id: 'leaf',
      title: 'Leaf',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [{ taskId: 'beta', type: 'hard' }],
    })

    const graph = buildTaskGraph([blockedLeaf, secondRoot, firstRoot])

    expect(graph.rootNodeIds).toEqual(['alpha', 'beta'])
    expect(graph.currentRootNodeId).toBe('alpha')
  })

  it('emits hard and soft edges and keeps soft blockers executable', () => {
    const hardSource = makeTask({
      id: 'hard-source',
      title: 'Hard Source',
      status: 'completed',
      createdAt: 10,
      updatedAt: 10,
    })
    const softSource = makeTask({
      id: 'soft-source',
      title: 'Soft Source',
      status: 'pending',
      createdAt: 20,
      updatedAt: 20,
    })
    const target = makeTask({
      id: 'target',
      title: 'Target',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [
        { taskId: 'hard-source', type: 'hard' },
        { taskId: 'soft-source', type: 'soft' },
      ],
    })

    const graph = buildTaskGraph([target, softSource, hardSource])
    const targetNode = graph.nodes.find((node) => node.id === 'target')

    expect(graph.edges).toEqual([
      {
        id: 'edge:hard-source->target:hard',
        source: 'hard-source',
        target: 'target',
        type: 'hard',
      },
      {
        id: 'edge:soft-source->target:soft',
        source: 'soft-source',
        target: 'target',
        type: 'soft',
      },
    ])
    expect(targetNode).toMatchObject({
      isRoot: false,
      isCompleted: false,
      isExecutable: true,
      isBlocked: true,
    })
  })

  it('does not block a soft dependency when the predecessor is in progress', () => {
    const predecessor = makeTask({
      id: 'soft-dep',
      title: 'Soft Dependency',
      status: 'in_progress',
      createdAt: 10,
      updatedAt: 10,
    })
    const task = makeTask({
      id: 'task',
      title: 'Task',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'soft-dep', type: 'soft' }],
    })

    const graph = buildTaskGraph([task, predecessor])
    const node = graph.nodes.find((candidate) => candidate.id === 'task')

    expect(node).toMatchObject({
      isBlocked: false,
      isExecutable: true,
    })
  })

  it('blocks a hard dependency when the predecessor is in progress', () => {
    const predecessor = makeTask({
      id: 'hard-dep',
      title: 'Hard Dependency',
      status: 'in_progress',
      createdAt: 10,
      updatedAt: 10,
    })
    const task = makeTask({
      id: 'task',
      title: 'Task',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'hard-dep', type: 'hard' }],
    })

    const graph = buildTaskGraph([task, predecessor])
    const node = graph.nodes.find((candidate) => candidate.id === 'task')

    expect(node).toMatchObject({
      isBlocked: true,
      isExecutable: false,
    })
  })

  it('does not crash on missing dependency targets', () => {
    const task = makeTask({
      id: 'dangling',
      title: 'Dangling Dependency',
      createdAt: 10,
      updatedAt: 10,
      dependsOn: [{ taskId: 'missing', type: 'hard' }],
    })

    const graph = buildTaskGraph([task])

    expect(graph.edges).toEqual([])
    expect(graph.rootNodeIds).toEqual(['dangling'])
    expect(graph.currentRootNodeId).toBe('dangling')
    expect(graph.nodes.find((node) => node.id === 'dangling')).toMatchObject({
      isBlocked: false,
      isExecutable: true,
    })
  })

  it('returns repeatable output for the same fixed input', () => {
    const rootA = makeTask({ id: 'a', title: 'A', createdAt: 10, updatedAt: 10 })
    const rootB = makeTask({ id: 'b', title: 'B', createdAt: 10, updatedAt: 10 })
    const child = makeTask({
      id: 'c',
      title: 'C',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [
        { taskId: 'a', type: 'hard' },
        { taskId: 'b', type: 'soft' },
      ],
    })

    const first = buildTaskGraph([rootA, rootB, child])
    const second = buildTaskGraph([child, rootB, rootA])

    expect(second).toEqual(first)
  })

  it('marks cyclic input without inventing source roots', () => {
    const taskA = makeTask({
      id: 'a',
      title: 'A',
      createdAt: 10,
      updatedAt: 10,
      dependsOn: [{ taskId: 'b', type: 'hard' }],
    })
    const taskB = makeTask({
      id: 'b',
      title: 'B',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    })

    const graph = buildTaskGraph([taskA, taskB])

    expect(graph.hasCycle).toBe(true)
    expect(graph.rootNodeIds).toEqual([])
    expect(graph.currentRootNodeId).toBeNull()
    expect(graph.topologicalOrder).toEqual(['a', 'b'])
  })
})
