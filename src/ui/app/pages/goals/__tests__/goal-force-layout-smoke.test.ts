import { describe, expect, it } from 'vitest';
import { simulateGoalLayoutTicks } from '../goal-force-layout';
import type { GoalGraph } from '../goal-types';

function makeThreeNodeChainGraph(): GoalGraph {
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
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: '',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-a-b',
        title: '',
        description: '',
        source: 'goal-a',
        target: 'goal-b',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeThreeNodeStarGraph(): GoalGraph {
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
        completionRule: [['edge-me-b']],
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: '',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'edge-me-b',
        title: '',
        description: '',
        source: 'me',
        target: 'goal-b',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  };
}

function makeFarAttractGraph(): GoalGraph {
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
        id: 'goal-d',
        title: 'D',
        description: '',
        cancelled: false,
        completionRule: [],
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [
      {
        id: 'edge-me-a',
        title: '',
        description: '',
        source: 'me',
        target: 'goal-a',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function expectFinitePositions(positions: Map<string, { x: number; y: number }>) {
  for (const position of positions.values()) {
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
  }
}

function angleFromPivot(pivot: { x: number; y: number }, point: { x: number; y: number }) {
  return Math.atan2(point.y - pivot.y, point.x - pivot.x);
}

function absoluteAngleDelta(left: number, right: number) {
  const delta = Math.abs(left - right);
  return Math.min(delta, Math.PI * 2 - delta);
}

describe('goal-force-layout smoke tests', () => {
  it('me-goal force moves goals toward distinct Me-centered layers without instability', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeChainGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: true,
        goalGoal: false,
        springLinks: false,
        charge: false,
        collide: false,
      },
      initialPositions: {
        'goal-a': { x: 32, y: 0 },
        'goal-b': { x: 56, y: 0 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, { x: 0, y: 0 })).toBeGreaterThan(distance(beforeA!, { x: 0, y: 0 }));
    expect(distance(afterB!, { x: 0, y: 0 })).toBeGreaterThan(distance(afterA!, { x: 0, y: 0 }));
  });

  it('goal-goal force changes goal spacing in a three-node chain without instability', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeChainGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: true,
        springLinks: false,
        charge: false,
        collide: false,
      },
      initialPositions: {
        'goal-a': { x: 160, y: 0 },
        'goal-b': { x: 176, y: 0 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, afterB!)).toBeGreaterThan(distance(beforeA!, beforeB!));
  });

  it('goal-goal far-attract changes distant spacing in the smallest extended chain without instability', () => {
    const result = simulateGoalLayoutTicks(makeFarAttractGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: true,
        springLinks: false,
        charge: false,
        collide: false,
      },
      initialPositions: {
        'goal-a': { x: 180, y: 0 },
        'goal-d': { x: 620, y: 0 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeD = result.before.get('goal-d');
    const afterA = result.after.get('goal-a');
    const afterD = result.after.get('goal-d');

    expect(beforeA).toBeDefined();
    expect(beforeD).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterD).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, afterD!)).toBeLessThan(distance(beforeA!, beforeD!));
  });

  it('spring-link force pulls linked goals closer in a three-node chain without instability', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeChainGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: false,
        springLinks: true,
        charge: false,
        collide: false,
      },
      initialPositions: {
        'goal-a': { x: 120, y: 0 },
        'goal-b': { x: 420, y: 0 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, afterB!)).toBeLessThan(distance(beforeA!, beforeB!));
  });

  it('charge force separates nearby goals in a three-node star without instability', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeStarGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: false,
        springLinks: false,
        charge: true,
        collide: false,
      },
      initialPositions: {
        'goal-a': { x: 180, y: 0 },
        'goal-b': { x: 196, y: 8 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, afterB!)).toBeGreaterThan(distance(beforeA!, beforeB!));
  });

  it('collision force resolves overlapping goals in a three-node star without instability', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeStarGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: false,
        springLinks: false,
        charge: false,
        collide: true,
      },
      initialPositions: {
        'goal-a': { x: 180, y: 0 },
        'goal-b': { x: 180, y: 0 },
      },
    });

    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);
    expect(distance(afterA!, afterB!)).toBeGreaterThan(distance(beforeA!, beforeB!));
  });

  it('edge-separation opens the fan around Me while keeping Me fixed', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeStarGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: false,
        springLinks: false,
        charge: false,
        collide: false,
        edgeSeparation: true,
      },
      initialPositions: {
        me: { x: 0, y: 0 },
        'goal-a': { x: 180, y: 0 },
        'goal-b': { x: 188, y: 6 },
      },
    });

    const beforeMe = result.before.get('me');
    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterMe = result.after.get('me');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeMe).toBeDefined();
    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterMe).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);

    const beforeAngle = absoluteAngleDelta(
      angleFromPivot(beforeMe!, beforeA!),
      angleFromPivot(beforeMe!, beforeB!),
    );
    const afterAngle = absoluteAngleDelta(
      angleFromPivot(afterMe!, afterA!),
      angleFromPivot(afterMe!, afterB!),
    );

    expect(afterMe).toEqual(beforeMe);
    expect(afterAngle).toBeGreaterThan(beforeAngle);
  });

  it('edge-separation increases the chain opening angle around a movable middle goal', () => {
    const result = simulateGoalLayoutTicks(makeThreeNodeChainGraph(), {
      ticks: 80,
      enabledForces: {
        meGoal: false,
        goalGoal: false,
        springLinks: false,
        charge: false,
        collide: false,
        edgeSeparation: true,
      },
      initialPositions: {
        me: { x: 0, y: 0 },
        'goal-a': { x: 180, y: 0 },
        'goal-b': { x: 220, y: 12 },
      },
    });

    const beforeMe = result.before.get('me');
    const beforeA = result.before.get('goal-a');
    const beforeB = result.before.get('goal-b');
    const afterMe = result.after.get('me');
    const afterA = result.after.get('goal-a');
    const afterB = result.after.get('goal-b');

    expect(beforeMe).toBeDefined();
    expect(beforeA).toBeDefined();
    expect(beforeB).toBeDefined();
    expect(afterMe).toBeDefined();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expectFinitePositions(result.after);
    expect(result.stable).toBe(true);

    const beforeAngle = absoluteAngleDelta(
      angleFromPivot(beforeA!, beforeMe!),
      angleFromPivot(beforeA!, beforeB!),
    );
    const afterAngle = absoluteAngleDelta(
      angleFromPivot(afterA!, afterMe!),
      angleFromPivot(afterA!, afterB!),
    );

    expect(afterAngle).toBeGreaterThan(beforeAngle);
  });
});
