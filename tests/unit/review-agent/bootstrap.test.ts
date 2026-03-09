import { describe, expect, it } from 'vitest';

import {
  decideBootstrapAction,
  type BootstrapContext,
} from '../../../Scripts/review-agent/bootstrap-lib.ts';

function makeContext(overrides: Partial<BootstrapContext> = {}): BootstrapContext {
  return {
    state: null,
    queue: null,
    openPrNumbers: [],
    ...overrides,
  };
}

describe('review-agent bootstrap router', () => {
  it('routes to discovery when no persisted state exists', () => {
    const result = decideBootstrapAction(makeContext());

    expect(result.nextPrompt).toBe('discovery');
    expect(result.reason).toBe('missing-state');
  });

  it('routes to review when state has a valid selected PR', () => {
    const result = decideBootstrapAction(
      makeContext({
        state: {
          state: 'HAS_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextPrompt: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 1,
          failureStreak: 0,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-09T15:00:00Z',
        },
        queue: {
          selectedPr: { number: 461 },
        },
        openPrNumbers: [461, 462],
      }),
    );

    expect(result.nextPrompt).toBe('review');
    expect(result.selectedPrNumber).toBe(461);
    expect(result.reason).toBe('resume-selected-pr');
  });

  it('falls back to discovery when selected PR is no longer open', () => {
    const result = decideBootstrapAction(
      makeContext({
        state: {
          state: 'HAS_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextPrompt: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 1,
          failureStreak: 0,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-09T15:00:00Z',
        },
        queue: {
          selectedPr: { number: 461 },
        },
        openPrNumbers: [462],
      }),
    );

    expect(result.nextPrompt).toBe('discovery');
    expect(result.reason).toBe('stale-selected-pr');
  });

  it('routes to idle-wait when state says no target', () => {
    const result = decideBootstrapAction(
      makeContext({
        state: {
          state: 'NO_TARGET',
          phase: 'DISCOVERY',
          lastPhase: 'DISCOVERY',
          nextPrompt: 'idle-wait',
          selectedPrNumber: null,
          selectedReason: null,
          inspectedPrCount: 5,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 0,
          nextSleepSeconds: 360,
          updatedAt: '2026-03-09T15:00:00Z',
        },
        openPrNumbers: [462],
      }),
    );

    expect(result.nextPrompt).toBe('idle-wait');
    expect(result.sleepSeconds).toBe(360);
    expect(result.reason).toBe('no-target');
  });

  it('retries review when the last retryable failure came from review and selected PR is still open', () => {
    const result = decideBootstrapAction(
      makeContext({
        state: {
          state: 'FAILED_RETRYABLE',
          phase: 'REVIEW',
          lastPhase: 'REVIEW',
          nextPrompt: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 0,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 1,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-09T15:00:00Z',
          error: 'temporary failure',
        },
        queue: {
          selectedPr: { number: 461 },
        },
        openPrNumbers: [461],
      }),
    );

    expect(result.nextPrompt).toBe('review');
    expect(result.reason).toBe('retry-review');
  });

  it('falls back to discovery when retryable failure does not have a valid review target', () => {
    const result = decideBootstrapAction(
      makeContext({
        state: {
          state: 'FAILED_RETRYABLE',
          phase: 'DISCOVERY',
          lastPhase: 'REVIEW',
          nextPrompt: 'review',
          selectedPrNumber: 461,
          selectedReason: 'new-comment',
          inspectedPrCount: 0,
          skippedPrCount: 0,
          actionableCount: 0,
          failureStreak: 1,
          nextSleepSeconds: 180,
          updatedAt: '2026-03-09T15:00:00Z',
          error: 'temporary failure',
        },
        queue: {
          selectedPr: { number: 461 },
        },
        openPrNumbers: [],
      }),
    );

    expect(result.nextPrompt).toBe('discovery');
    expect(result.reason).toBe('retry-discovery');
  });
});
