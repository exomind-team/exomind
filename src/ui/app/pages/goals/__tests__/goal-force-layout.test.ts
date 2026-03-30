import { describe, expect, it } from 'vitest';
import {
  GOAL_LAYOUT_VELOCITY_DECAY,
  buildForcePairSpecs,
  buildSpringLinks,
  createSeededGoalLayoutRandom,
  resolveMeGoalRepulsionDistance,
  resolveMeGoalRepulsionStrength,
  resolveGoalLayoutInitialPolar,
} from '../goal-force-layout';
import type { GoalGraph } from '../goal-types';

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
      {
        id: 'goal-d',
        title: 'D',
        description: '',
        cancelled: false,
        completionRule: [['edge-c-d']],
        createdAt: 4,
        updatedAt: 4,
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
      {
        id: 'edge-b-c',
        title: '',
        description: '',
        source: 'goal-b',
        target: 'goal-c',
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'edge-c-d',
        title: '',
        description: '',
        source: 'goal-c',
        target: 'goal-d',
        createdAt: 4,
        updatedAt: 4,
      },
    ],
  };
}

describe('goal-force-layout', () => {
  it('uses the lower friction constraint for the layered goal simulation', () => {
    expect(GOAL_LAYOUT_VELOCITY_DECAY).toBeLessThanOrEqual(0.01);
  });

  it('classifies Me-goal, near-goal, and far-goal force pairs by hop distance', () => {
    const specs = buildForcePairSpecs(makeGraph());

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'me',
          target: 'goal-a',
          kind: 'me-goal-repel',
          hopDistance: 1,
          linked: false,
        }),
        expect.objectContaining({
          source: 'goal-a',
          target: 'goal-b',
          kind: 'goal-goal-near-repel',
          hopDistance: 1,
          linked: true,
        }),
        expect.objectContaining({
          source: 'goal-a',
          target: 'goal-c',
          kind: 'goal-goal-near-repel',
          hopDistance: 2,
          linked: false,
        }),
        expect.objectContaining({
          source: 'goal-a',
          target: 'goal-d',
          kind: 'goal-goal-far-attract',
          hopDistance: 3,
          linked: false,
        }),
      ]),
    );
  });

  it('pushes farther-hop goals into a meaningfully farther Me-centered layer', () => {
    const hopOneDistance = resolveMeGoalRepulsionDistance(1);
    const hopTwoDistance = resolveMeGoalRepulsionDistance(2);
    const hopThreeDistance = resolveMeGoalRepulsionDistance(3);

    expect(hopOneDistance).toBeGreaterThan(0);
    expect(hopTwoDistance).toBeGreaterThan(hopOneDistance);
    expect(hopTwoDistance / hopOneDistance).toBeGreaterThanOrEqual(1);
    expect(hopTwoDistance / hopOneDistance).toBeLessThanOrEqual(2.2);
    expect(hopThreeDistance).toBeGreaterThan(hopTwoDistance);
    expect(resolveMeGoalRepulsionStrength(2)).toBeGreaterThan(resolveMeGoalRepulsionStrength(1));
  });

  it('creates explicit spring links for every visible edge, including Me-to-goal edges', () => {
    const links = buildSpringLinks(makeGraph());

    expect(links).toEqual([
      { source: 'me', target: 'goal-a' },
      { source: 'goal-a', target: 'goal-b' },
      { source: 'goal-b', target: 'goal-c' },
      { source: 'goal-c', target: 'goal-d' },
    ]);
  });

  it('provides deterministic seeded layout randomness for randomized stability samples', () => {
    const left = createSeededGoalLayoutRandom(123456);
    const right = createSeededGoalLayoutRandom(123456);
    const sampleLeft = [left(), left(), left(), left()];
    const sampleRight = [right(), right(), right(), right()];

    expect(sampleLeft).toEqual(sampleRight);
    sampleLeft.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  it('allows fixed polar samples to cover explicit angles after randomized samples pass', () => {
    const random = () => 0.5;
    const fixed = resolveGoalLayoutInitialPolar({
      initial: false,
      nextRandom: random,
      fixedPolarSequence: [
        { angle: 0, distance: 80 },
        { angle: Math.PI / 2, distance: 96 },
      ],
      sequenceIndex: 1,
    });
    const fallback = resolveGoalLayoutInitialPolar({
      initial: false,
      nextRandom: random,
      fixedPolarSequence: [
        { angle: 0, distance: 80 },
      ],
      sequenceIndex: 3,
    });
    const preferred = resolveGoalLayoutInitialPolar({
      initial: false,
      nextRandom: random,
      preferredAngle: Math.PI / 3,
      preferredDistance: 144,
      sequenceIndex: 0,
    });

    expect(fixed).toEqual({ angle: Math.PI / 2, distance: 96 });
    expect(fallback.angle).toBeCloseTo(Math.PI, 6);
    expect(fallback.distance).toBeCloseTo(80, 6);
    expect(preferred).toEqual({ angle: Math.PI / 3, distance: 144 });
  });
});
