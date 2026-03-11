import { describe, expect, it } from 'vitest';

import {
  decideNextAction,
  type RouterContext,
} from '../../../Scripts/review-agent/router-lib.ts';

function makeContext(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    state: null,
    queue: null,
    openPrNumbers: [],
    selectedPrUpdatedAt: null,
    ...overrides,
  };
}

describe('review-agent router', () => {
  it('routes to discovery when no persisted state exists', () => {
    const result = decideNextAction(makeContext());

    expect(result.action).toBe('discovery');
    expect(result.reason).toBe('missing-state');
    expect((result as { referencesMustRead?: string[] }).referencesMustRead).toEqual([
      'docs/agents/review-agent/discovery-loop.md',
    ]);
  });

  it('routes to review when state has a valid selected PR', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'HAS_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextAction: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 1,
          failureStreak: 0,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-10T01:00:00Z',
        },
        queue: {
          selectedPr: {
            number: 461,
            updatedAt: '2026-03-10T02:00:00Z',
          },
        },
        openPrNumbers: [461, 462],
        selectedPrUpdatedAt: '2026-03-10T02:00:00Z',
      }),
    );

    expect(result.action).toBe('review');
    expect(result.selectedPrNumber).toBe(461);
    expect(result.reason).toBe('resume-selected-pr');
    expect((result as { referencesMustRead?: string[] }).referencesMustRead).toEqual([
      'docs/agents/review-agent/review-loop.md',
    ]);
  });

  it('falls back to discovery when selected PR is no longer open', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'HAS_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextAction: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 1,
          failureStreak: 0,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-10T01:00:00Z',
        },
        queue: {
          selectedPr: {
            number: 461,
            updatedAt: '2026-03-10T02:00:00Z',
          },
        },
        openPrNumbers: [462],
      }),
    );

    expect(result.action).toBe('discovery');
    expect(result.reason).toBe('stale-selected-pr');
  });

  it('reruns discovery when state says no target so GitHub remote truth can be recomputed', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'NO_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextAction: 'idle-wait',
          selectedPrNumber: null,
          selectedReason: null,
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 0,
          nextSleepSeconds: 360,
          updatedAt: '2026-03-10T01:00:00Z',
        },
        openPrNumbers: [462],
      }),
    );

    expect(result.action).toBe('discovery');
    expect(result.sleepSeconds).toBe(0);
    expect(result.reason).toBe('recheck-no-target');
  });

  it('retries review when the last retryable failure came from review and selected PR is still open', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'FAILED_RETRYABLE',
          phase: 'REVIEW',
          lastPhase: 'REVIEW',
          nextAction: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 0,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 1,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-10T01:00:00Z',
          error: 'temporary failure',
        },
        queue: {
          selectedPr: {
            number: 461,
            updatedAt: '2026-03-10T02:00:00Z',
          },
        },
        openPrNumbers: [461],
        selectedPrUpdatedAt: '2026-03-10T02:00:00Z',
      }),
    );

    expect(result.action).toBe('review');
    expect(result.reason).toBe('retry-review');
  });

  it('falls back to discovery when retryable failure does not have a valid review target', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'FAILED_RETRYABLE',
          phase: 'DISCOVERY',
          lastPhase: 'REVIEW',
          nextAction: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 0,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 1,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-10T01:00:00Z',
          error: 'temporary failure',
        },
        queue: {
          selectedPr: {
            number: 461,
            updatedAt: '2026-03-10T02:00:00Z',
          },
        },
        openPrNumbers: [],
      }),
    );

    expect(result.action).toBe('discovery');
    expect(result.reason).toBe('retry-discovery');
  });

  it('routes back to discovery after a review loop terminal state is persisted', () => {
    const terminalStates = ['REVIEW_POSTED', 'NEEDS_HUMAN_TEST', 'APPROVE_READY', 'MERGE_READY', 'MERGE_BLOCKED'] as const;

    for (const terminalState of terminalStates) {
      const result = decideNextAction(
        makeContext({
          state: {
            state: terminalState,
            phase: 'REVIEW',
            lastPhase: 'REVIEW',
            nextAction: 'review',
            selectedPrNumber: 461,
            selectedReason: 'new-comment',
            inspectedPrCount: 5,
            skippedPrCount: 0,
            actionableCount: 1,
            failureStreak: 0,
            nextSleepSeconds: 180,
            updatedAt: '2026-03-10T01:00:00Z',
          },
          queue: {
            selectedPr: {
              number: 461,
              updatedAt: '2026-03-10T02:00:00Z',
            },
          },
          openPrNumbers: [461, 462],
          selectedPrUpdatedAt: '2026-03-10T02:00:00Z',
        }),
      );

      expect(result.action).toBe('discovery');
      expect(result.reason).toBe('review-finished');
    }
  });

  it('falls back to discovery when the selected PR changed remotely after the last discovery queue snapshot', () => {
    const result = decideNextAction(
      makeContext({
        state: {
          state: 'HAS_TARGET',
          phase: 'REVIEW',
          lastPhase: 'DISCOVERY',
          nextAction: 'review',
          selectedPrNumber: 466,
          selectedReason: 'new-comment',
          inspectedPrCount: 9,
          skippedPrCount: 0,
          actionableCount: 2,
          failureStreak: 0,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-10T18:04:15Z',
        },
        queue: {
          selectedPr: {
            number: 466,
            updatedAt: '2026-03-10T18:01:16Z',
          },
        },
        openPrNumbers: [465, 466],
        selectedPrUpdatedAt: '2026-03-10T18:05:05Z',
      }),
    );

    expect(result.action).toBe('discovery');
    expect(result.reason).toBe('stale-selected-pr');
  });
});
