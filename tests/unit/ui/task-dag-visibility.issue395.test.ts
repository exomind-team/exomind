import { describe, expect, it } from 'vitest'
import type { TaskNode } from '@/lib/types/task'
import { buildTaskGraph } from '@/lib/task/task-dag-graph'
import { projectVisibleTaskGraph } from '@/lib/task/task-dag-visibility'

function makeTask(overrides: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title'>): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('projectVisibleTaskGraph issue-395（任务 DAG 折叠投影第一阶段）', () => {
  it('collapses a target node upstream while keeping the target visible', () => {
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
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['c'] })

    expect(visible.state.collapsedUpstreamOf).toEqual(['c'])
    expect(visible.hiddenNodeIds).toEqual(['a', 'b'])
    expect(visible.nodes).toEqual([
      expect.objectContaining({
        id: 'c',
        isCollapsedTarget: true,
        hiddenUpstreamCount: 2,
      }),
    ])
    expect(visible.edges).toEqual([])
    expect(visible.visibleRootNodeIds).toEqual(['c'])
    expect(visible.visibleCurrentRootNodeId).toBe('c')
  })

  it('restores the full graph when no node is collapsed', () => {
    const root = makeTask({ id: 'root', title: 'Root', createdAt: 10, updatedAt: 10 })
    const child = makeTask({
      id: 'child',
      title: 'Child',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'root', type: 'hard' }],
    })
    const sideRoot = makeTask({ id: 'side', title: 'Side', createdAt: 15, updatedAt: 15 })

    const graph = buildTaskGraph([child, sideRoot, root])
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: [] })

    expect(visible.hiddenNodeIds).toEqual([])
    expect(visible.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id))
    expect(visible.nodes.every((node) => node.hiddenUpstreamCount === 0)).toBe(true)
    expect(visible.nodes.every((node) => node.isCollapsedTarget === false)).toBe(true)
    expect(visible.edges).toEqual(graph.edges)
    expect(visible.visibleRootNodeIds).toEqual(graph.rootNodeIds)
    expect(visible.visibleCurrentRootNodeId).toBe(graph.currentRootNodeId)
  })

  it('counts hidden upstream nodes on deeper visible descendants', () => {
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
    const taskD = makeTask({
      id: 'd',
      title: 'D',
      createdAt: 40,
      updatedAt: 40,
      dependsOn: [{ taskId: 'c', type: 'hard' }],
    })

    const graph = buildTaskGraph([taskD, taskB, taskA, taskC])
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['c'] })

    expect(visible.hiddenNodeIds).toEqual(['a', 'b'])
    expect(visible.nodes.map((node) => ({ id: node.id, hidden: node.hiddenUpstreamCount }))).toEqual([
      { id: 'c', hidden: 2 },
      { id: 'd', hidden: 2 },
    ])
    expect(visible.edges).toEqual([
      {
        id: 'edge:c->d:hard',
        source: 'c',
        target: 'd',
        type: 'hard',
      },
    ])
  })

  it('keeps the projection stable with multiple collapse targets', () => {
    const taskA = makeTask({ id: 'a', title: 'A', createdAt: 10, updatedAt: 10 })
    const taskB = makeTask({
      id: 'b',
      title: 'B',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    })
    const taskX = makeTask({ id: 'x', title: 'X', createdAt: 30, updatedAt: 30 })
    const taskY = makeTask({
      id: 'y',
      title: 'Y',
      createdAt: 40,
      updatedAt: 40,
      dependsOn: [{ taskId: 'x', type: 'soft' }],
    })

    const graph = buildTaskGraph([taskY, taskB, taskA, taskX])
    const first = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['y', 'b', 'y'] })
    const second = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['b', 'y'] })

    expect(first).toEqual(second)
    expect(first.hiddenNodeIds).toEqual(['a', 'x'])
    expect(first.nodes.map((node) => node.id)).toEqual(['b', 'y'])
    expect(first.visibleRootNodeIds).toEqual(['b', 'y'])
    expect(first.visibleCurrentRootNodeId).toBe('b')
  })

  it('does not mutate the truth graph or rewrite blocked and executable flags', () => {
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
      status: 'not_started',
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
    const snapshot = JSON.parse(JSON.stringify(graph))
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['target'] })
    const visibleTarget = visible.nodes.find((node) => node.id === 'target')
    const graphTarget = graph.nodes.find((node) => node.id === 'target')

    expect(graph).toEqual(snapshot)
    expect(visibleTarget).toMatchObject({
      isBlocked: graphTarget?.isBlocked,
      isExecutable: graphTarget?.isExecutable,
    })
  })

  it('derives visible roots and current root from visible edges without changing the truth layer', () => {
    const rootA = makeTask({ id: 'a', title: 'A', createdAt: 10, updatedAt: 10 })
    const rootX = makeTask({ id: 'x', title: 'X', createdAt: 20, updatedAt: 20 })
    const taskB = makeTask({
      id: 'b',
      title: 'B',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [{ taskId: 'a', type: 'hard' }],
    })

    const graph = buildTaskGraph([taskB, rootX, rootA])
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['b'] })

    expect(graph.rootNodeIds).toEqual(['a', 'x'])
    expect(graph.currentRootNodeId).toBe('a')
    expect(visible.visibleRootNodeIds).toEqual(['x', 'b'])
    expect(visible.visibleCurrentRootNodeId).toBe('x')
  })

  it('returns repeatable output for a fixed graph and collapse state', () => {
    const root = makeTask({ id: 'root', title: 'Root', createdAt: 10, updatedAt: 10 })
    const middle = makeTask({
      id: 'middle',
      title: 'Middle',
      createdAt: 20,
      updatedAt: 20,
      dependsOn: [{ taskId: 'root', type: 'hard' }],
    })
    const leaf = makeTask({
      id: 'leaf',
      title: 'Leaf',
      createdAt: 30,
      updatedAt: 30,
      dependsOn: [{ taskId: 'middle', type: 'hard' }],
    })

    const graph = buildTaskGraph([leaf, root, middle])
    const first = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['leaf'] })
    const second = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['leaf'] })

    expect(second).toEqual(first)
  })

  it('does not invent a visible current root when the source graph is cyclic', () => {
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
    const visible = projectVisibleTaskGraph(graph, { collapsedUpstreamOf: ['a'] })

    expect(graph.hasCycle).toBe(true)
    expect(graph.rootNodeIds).toEqual([])
    expect(graph.currentRootNodeId).toBeNull()
    expect(visible.hasCycle).toBe(true)
    expect(visible.visibleRootNodeIds).toEqual(['a'])
    expect(visible.visibleCurrentRootNodeId).toBeNull()
    expect(visible.sourceCurrentRootNodeId).toBeNull()
  })
})
