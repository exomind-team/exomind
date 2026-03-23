import { describe, expect, it } from 'vitest';
import type { ActiveBlockData } from '@/lib/types/event';
import { resolveCountdownOverrunMs } from '@/lib/timeblock/countdown-overrun';

function createCountdownBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  const now = 1_700_000_000_000;
  return {
    startId: 'block-1',
    name: 'Countdown block',
    mode: 'countdown',
    targetMinutes: 1,
    elapsed: 0,
    startTime: now - 70_000,
    paused: false,
    phase: 'running',
    version: 1,
    actorId: 'actor-1',
    lastTransitionAt: now - 10_000,
    lastResumedAt: now - 10_000,
    accumulatedRunMs: 60_000,
    pauseAccumulatedMs: 0,
    ...overrides,
  };
}

describe('resolveCountdownOverrunMs', () => {
  it('returns positive overtime when running duration exceeds expected duration', () => {
    const now = 1_700_000_000_000;
    const block = createCountdownBlock({
      accumulatedRunMs: 70_000,
      lastResumedAt: now - 5_000,
    });

    expect(resolveCountdownOverrunMs(block, now)).toBe(15_000);
  });

  it('freezes overtime during paused state', () => {
    const now = 1_700_000_000_000;
    const block = createCountdownBlock({
      paused: true,
      phase: 'paused',
      pausedAt: now - 15_000,
      accumulatedRunMs: 90_000,
      lastResumedAt: undefined,
    });

    expect(resolveCountdownOverrunMs(block, now)).toBe(30_000);
  });

  it('freezes overtime at actionEndedAt during feedback stage', () => {
    const now = 1_700_000_000_000;
    const block = createCountdownBlock({
      phase: 'feedback_in_progress',
      actionEndedAt: now - 20_000,
      accumulatedRunMs: 95_000,
      lastResumedAt: undefined,
    });

    expect(resolveCountdownOverrunMs(block, now)).toBe(35_000);
  });

  it('returns zero for countup blocks', () => {
    const block = createCountdownBlock({
      mode: 'countup',
      targetMinutes: undefined,
      elapsed: 1234,
    });

    expect(resolveCountdownOverrunMs(block, 1_700_000_000_000)).toBe(0);
  });
});
