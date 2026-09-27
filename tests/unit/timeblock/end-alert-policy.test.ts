import { describe, expect, it } from 'vitest';
import { resolveTimeblockEndAlertRequest } from '@/lib/timeblock/end-alert-policy';
import type { ActiveBlockData } from '@/lib/types/event';

function buildRunningCountdownBlock(): ActiveBlockData {
  const startTime = Date.UTC(2026, 3, 16, 2, 0, 0);
  return {
    startId: 'timeblock-end-alert-running',
    name: 'Deep Work',
    startTime,
    mode: 'countdown',
    targetMinutes: 25,
    phase: 'running',
    paused: false,
    lastTransitionAt: startTime,
    lastResumedAt: startTime,
    accumulatedRunMs: 0,
    pauseAccumulatedMs: 0,
    transitions: [{ type: 'start', at: startTime }],
  };
}

describe('resolveTimeblockEndAlertRequest', () => {
  it('returns a native alert request when countdown is running outside the focus page owner', () => {
    const now = Date.UTC(2026, 3, 16, 2, 5, 0);
    const request = resolveTimeblockEndAlertRequest({
      block: buildRunningCountdownBlock(),
      frontendOwnsCountdownEnd: false,
      soundEnabled: true,
      autoOpenFocus: false,
      now,
    });

    expect(request).toEqual({
      startId: 'timeblock-end-alert-running',
      title: 'Deep Work',
      dueAt: Date.UTC(2026, 3, 16, 2, 25, 0),
      soundEnabled: true,
      autoOpenFocus: false,
    });
  });

  it('returns null when the visible focus page already owns countdown end behavior', () => {
    const request = resolveTimeblockEndAlertRequest({
      block: buildRunningCountdownBlock(),
      frontendOwnsCountdownEnd: true,
      soundEnabled: true,
      autoOpenFocus: true,
    });

    expect(request).toBeNull();
  });

  it('returns null for paused or feedback-stage blocks', () => {
    const pausedBlock: ActiveBlockData = {
      ...buildRunningCountdownBlock(),
      phase: 'paused',
      paused: true,
      pausedAt: Date.UTC(2026, 3, 16, 2, 10, 0),
      transitions: [
        { type: 'start', at: Date.UTC(2026, 3, 16, 2, 0, 0) },
        { type: 'pause', at: Date.UTC(2026, 3, 16, 2, 10, 0) },
      ],
    };
    const feedbackBlock: ActiveBlockData = {
      ...buildRunningCountdownBlock(),
      phase: 'feedback_in_progress',
      actionEndedAt: Date.UTC(2026, 3, 16, 2, 25, 0),
      transitions: [
        { type: 'start', at: Date.UTC(2026, 3, 16, 2, 0, 0) },
        { type: 'feedback_start', at: Date.UTC(2026, 3, 16, 2, 25, 0) },
      ],
    };

    expect(resolveTimeblockEndAlertRequest({
      block: pausedBlock,
      frontendOwnsCountdownEnd: false,
      soundEnabled: true,
      autoOpenFocus: false,
    })).toBeNull();
    expect(resolveTimeblockEndAlertRequest({
      block: feedbackBlock,
      frontendOwnsCountdownEnd: false,
      soundEnabled: true,
      autoOpenFocus: false,
    })).toBeNull();
  });

  it('uses the stable expected end timestamp when the block is already overdue', () => {
    const block = buildRunningCountdownBlock();
    const first = resolveTimeblockEndAlertRequest({
      block,
      frontendOwnsCountdownEnd: false,
      soundEnabled: true,
      autoOpenFocus: true,
      now: Date.UTC(2026, 3, 16, 2, 26, 0),
    });
    const later = resolveTimeblockEndAlertRequest({
      block,
      frontendOwnsCountdownEnd: false,
      soundEnabled: true,
      autoOpenFocus: true,
      now: Date.UTC(2026, 3, 16, 2, 31, 0),
    });

    expect(first).toEqual({
      startId: 'timeblock-end-alert-running',
      title: 'Deep Work',
      dueAt: Date.UTC(2026, 3, 16, 2, 25, 0),
      soundEnabled: true,
      autoOpenFocus: true,
    });
    expect(later?.dueAt).toBe(first?.dueAt);
  });
});
