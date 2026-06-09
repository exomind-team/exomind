import { describe, expect, it } from 'vitest';
import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';
import type { TimeBlockData } from '@/lib/types/event';

describe('resolveCountdownTiming', () => {
  it('does not double count the current running slice when transitions are present', () => {
    const now = Date.UTC(2026, 3, 15, 2, 0, 0);
    const startedAt = now - 5 * 60 * 1000;
    const block: TimeBlockData = {
      startId: 'countdown-progress-running',
      name: 'Countdown Progress',
      startTime: startedAt,
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 25 * 60 * 1000,
      paused: false,
      phase: 'running',
      lastTransitionAt: startedAt,
      lastResumedAt: startedAt,
      accumulatedRunMs: 0,
      pauseAccumulatedMs: 0,
      transitions: [
        { type: 'start', at: startedAt, actorId: 'rt:newblock' },
      ],
    };

    const timing = resolveCountdownTiming(block, now);

    expect(timing).not.toBeNull();
    expect(timing?.workDurationMs).toBe(5 * 60 * 1000);
    expect(timing?.remainingMs).toBe(20 * 60 * 1000);
    expect(timing?.overrunMs).toBe(0);
  });
});
