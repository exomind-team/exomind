import { describe, expect, it } from 'vitest';
import {
  cancelGoal,
  clearAllEdgeStatusOverrides,
  clearEdgeStatusOverride,
  createEdge,
  createGoal,
  deleteEdge,
  deriveGoalDisplayStatus,
  evaluateCompletion,
  getEdgeStatus,
  getHopDistance,
  getInEdges,
  getOutEdges,
  setEdgeStatusOverride,
  updateEdge,
  updateGoal,
  wouldCreateCycle,
} from '../goal-logic';
import type {
  GoalGraph,
  GoalNode,
  TaskEdge,
  TaskEdgeStatus,
} from '../goal-types';

function makeGraph(): GoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [
      {
        id: 'goal-a',
        title: 'A',
        description: '',
        cancelled: false,
        completionRule: [['edge-me-a']],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'goal-b',
        title: 'B',
        description: '',
        cancelled: false,
        completionRule: [['edge-a-b']],
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'goal-c',
        title: 'C',
        description: '',
        cancelled: false,
        completionRule: [['edge-b-c']],
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: '',
        description: '',
        source: 'me',
        target: 'goal-a',
        taskNodeRef: 'task-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-a-b',
        title: '',
        description: '',
        source: 'goal-a',
        target: 'goal-b',
        taskNodeRef: 'task-b',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'edge-b-c',
        title: '',
        description: '',
        source: 'goal-b',
        target: 'goal-c',
        taskNodeRef: 'task-c',
        createdAt: 3,
        updatedAt: 3,
      },
    ],
  };
}

function getTaskStatus(taskNodeRef: string): TaskEdgeStatus {
  return {
    'task-a': 'completed',
    'task-b': 'in_progress',
    'task-c': 'cancelled',
  }[taskNodeRef] as TaskEdgeStatus;
}

describe('goal-logic', () => {
  it('derives edge and goal status from tasks, rules, and overrides', () => {
    const graph = makeGraph();
    const goalA = graph.goals.find((goal) => goal.id === 'goal-a') as GoalNode;
    const goalB = graph.goals.find((goal) => goal.id === 'goal-b') as GoalNode;
    const goalC = graph.goals.find((goal) => goal.id === 'goal-c') as GoalNode;

    expect(getEdgeStatus(graph.edges[0], { getTaskStatus })).toBe('completed');
    expect(getEdgeStatus(graph.edges[1], { getTaskStatus })).toBe('in_progress');
    expect(getEdgeStatus(graph.edges[2], { getTaskStatus })).toBe('cancelled');
    expect(
      getEdgeStatus(graph.edges[2], {
        getTaskStatus,
        edgeOverrides: new Map([['edge-b-c', 'suspended']]),
      }),
    ).toBe('suspended');

    expect(
      evaluateCompletion(goalA.completionRule, {
        graph,
        getTaskStatus,
      }),
    ).toBe(true);
    expect(
      deriveGoalDisplayStatus(goalA, getInEdges(graph, 'goal-a'), {
        graph,
        getTaskStatus,
      }),
    ).toBe('completed');
    expect(
      deriveGoalDisplayStatus(goalB, getInEdges(graph, 'goal-b'), {
        graph,
        getTaskStatus,
      }),
    ).toBe('in_progress');
    expect(
      deriveGoalDisplayStatus(goalC, getInEdges(graph, 'goal-c'), {
        graph,
        getTaskStatus,
      }),
    ).toBe('suspended');
  });

  it('supports AND / OR / mixed completion rules and removed edges', () => {
    const graph = makeGraph();
    const goal = graph.goals.find((item) => item.id === 'goal-c') as GoalNode;

    expect(
      evaluateCompletion([['edge-me-a', 'edge-a-b']], {
        graph,
        getTaskStatus: (taskNodeRef) =>
          taskNodeRef === 'task-a' || taskNodeRef === 'task-b' ? 'completed' : 'pending',
      }),
    ).toBe(true);
    expect(
      evaluateCompletion([['missing-edge'], ['edge-b-c']], {
        graph,
        getTaskStatus,
      }),
    ).toBe(false);
    expect(
      updateGoal(graph, {
        goalId: goal.id,
        completionRule: [['edge-b-c'], [], ['missing-edge']],
      }).ok,
    ).toBe(false);
  });

  it('creates downstream and upstream goals with matching edges and rules', () => {
    const graph = makeGraph();
    const createId = (() => {
      let index = 0;
      return (prefix: string) => `${prefix}-${++index}`;
    })();

    const downstream = createGoal(
      graph,
      { fromNode: 'goal-b', direction: 'downstream', title: 'D' },
      { createId, now: () => 10, getTaskStatus },
    );

    expect(downstream.ok).toBe(true);
    if (!downstream.ok) return;
    expect(downstream.value.goal.title).toBe('D');
    expect(downstream.value.edge.source).toBe('goal-b');
    expect(downstream.value.edge.target).toBe(downstream.value.goal.id);
    expect(downstream.value.goal.completionRule).toEqual([[downstream.value.edge.id]]);

    const upstream = createGoal(
      downstream.value.graph,
      { fromNode: 'goal-b', direction: 'upstream', title: 'Need B' },
      { createId, now: () => 20, getTaskStatus },
    );

    expect(upstream.ok).toBe(true);
    if (!upstream.ok) return;
    expect(upstream.value.edge.target).toBe('goal-b');
    expect(upstream.value.goal.completionRule).toEqual([]);
    const updatedGoalB = upstream.value.graph.goals.find((goal) => goal.id === 'goal-b') as GoalNode;
    expect(updatedGoalB.completionRule[0]).toContain(upstream.value.edge.id);
  });

  it('rejects invalid createEdge calls and detects cycles', () => {
    const graph = makeGraph();

    expect(wouldCreateCycle(graph, 'goal-c', 'goal-a')).toBe(true);
    expect(
      createEdge(graph, {
        source: 'goal-c',
        target: 'goal-a',
        rulePosition: { clauseIndex: 0 },
      }).ok,
    ).toBe(false);

    const completedGraph = {
      ...graph,
      goals: graph.goals.map((goal) =>
        goal.id === 'goal-a' ? { ...goal, completionRule: [['edge-me-a']] } : goal,
      ),
    };
    expect(
      createEdge(completedGraph, {
        source: 'goal-b',
        target: 'goal-a',
        rulePosition: { clauseIndex: 0 },
      }, { getTaskStatus }).ok,
    ).toBe(false);
  });

  it('deletes edges, maintains rules, and auto-adds a Me edge for isolated goals', () => {
    const graph = makeGraph();
    const result = deleteEdge(graph, { edgeId: 'edge-b-c' }, {
      createId: (prefix) => `${prefix}-auto`,
      now: () => 50,
      getTaskStatus,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const goalC = result.value.graph.goals.find((goal) => goal.id === 'goal-c') as GoalNode;
    const autoEdge = result.value.graph.edges.find((edge) => edge.id === 'edge-auto') as TaskEdge;
    expect(autoEdge.source).toBe('me');
    expect(autoEdge.target).toBe('goal-c');
    expect(goalC.completionRule).toEqual([['edge-auto']]);
  });

  it('prevents cancelling completed goals and freezes completed targets', () => {
    const graph = makeGraph();

    expect(cancelGoal(graph, { goalId: 'goal-a' }, { getTaskStatus }).ok).toBe(false);
    expect(
      updateEdge(graph, { edgeId: 'edge-me-a', title: 'rename' }, { getTaskStatus }).ok,
    ).toBe(false);
    expect(
      updateGoal(graph, { goalId: 'goal-a', title: 'rename' }, { getTaskStatus }).ok,
    ).toBe(false);
  });

  it('updates mutable goals and edges when not frozen', () => {
    const graph = makeGraph();
    const result = updateGoal(graph, {
      goalId: 'goal-b',
      title: 'Goal B+',
      description: 'desc',
      completionRule: [['edge-a-b']],
    }, { getTaskStatus });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graph.goals.find((goal) => goal.id === 'goal-b')?.title).toBe('Goal B+');

    const edgeResult = updateEdge(result.value.graph, {
      edgeId: 'edge-a-b',
      title: 'Task B',
      description: 'desc',
      taskNodeRef: 'task-next',
    }, {
      getTaskStatus: () => 'pending',
    });
    expect(edgeResult.ok).toBe(true);
    if (!edgeResult.ok) return;
    expect(edgeResult.value.graph.edges.find((edge) => edge.id === 'edge-a-b')?.taskNodeRef).toBe('task-next');
  });

  it('returns in/out edges and hop distance excluding cancelled paths', () => {
    const graph = makeGraph();

    expect(getInEdges(graph, 'goal-b').map((edge) => edge.id)).toEqual(['edge-a-b']);
    expect(getOutEdges(graph, 'goal-b').map((edge) => edge.id)).toEqual(['edge-b-c']);
    expect(getHopDistance(graph, 'goal-c', { getTaskStatus })).toBe(Infinity);
    expect(getHopDistance(graph, 'goal-b', { getTaskStatus })).toBe(2);
  });

  it('manages prototype edge status overrides immutably', () => {
    const initial = new Map<string, TaskEdgeStatus>();
    const next = setEdgeStatusOverride(initial, 'edge-a-b', 'completed');
    expect(initial.size).toBe(0);
    expect(next.get('edge-a-b')).toBe('completed');
    expect(clearEdgeStatusOverride(next, 'edge-a-b').size).toBe(0);
    expect(clearAllEdgeStatusOverrides(next).size).toBe(0);
  });
});
