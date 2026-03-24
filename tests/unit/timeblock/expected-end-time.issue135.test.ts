import { describe, expect, it } from 'vitest';
import type { ActiveBlockData } from '@/lib/types/event';
import { resolveCountdownEndTimeDisplay } from '@/lib/timeblock/expected-end-time';

function createCountdownBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  const now = Date.UTC(2026, 1, 11, 12, 0, 0);

  return {
    startId: 'block-issue-135',
    name: 'Issue 135 countdown',
    mode: 'countdown',
    targetMinutes: 25,
    elapsed: 0,
    startTime: now - 7 * 60 * 1000,
    paused: false,
    phase: 'running',
    version: 1,
    actorId: 'actor-135',
    lastTransitionAt: now,
    lastResumedAt: now,
    accumulatedRunMs: 7 * 60 * 1000,
    pauseAccumulatedMs: 0,
    ...overrides,
  };
}

describe('resolveCountdownEndTimeDisplay (issue #135)', () => {
  const now = Date.UTC(2026, 1, 11, 12, 0, 0);
  const formatOptions = { locale: 'zh-CN', timeZone: 'UTC' } as const;

  it('returns expected end time for a running countdown', () => {
    const result = resolveCountdownEndTimeDisplay({
      block: createCountdownBlock(),
      now,
      ...formatOptions,
    });

    expect(result).toMatchObject({
      kind: 'expected',
      timestamp: Date.UTC(2026, 1, 11, 12, 18, 0),
      timeText: '12:18',
      text: '预计 12:18 结束',
    });
  });

  it('returns a paused expected label based on resuming now', () => {
    const result = resolveCountdownEndTimeDisplay({
      block: createCountdownBlock({
        paused: true,
        phase: 'paused',
        pausedAt: now - 3 * 60 * 1000,
        accumulatedRunMs: 10 * 60 * 1000,
        lastResumedAt: undefined,
      }),
      now,
      ...formatOptions,
    });

    expect(result).toMatchObject({
      kind: 'expected',
      timestamp: Date.UTC(2026, 1, 11, 12, 15, 0),
      timeText: '12:15',
      text: '暂停中，若恢复预计 12:15 结束',
    });
  });

  it('returns actual due time after countdown enters soft overtime', () => {
    const result = resolveCountdownEndTimeDisplay({
      block: createCountdownBlock({
        accumulatedRunMs: 27 * 60 * 1000,
        lastResumedAt: now,
      }),
      now,
      ...formatOptions,
    });

    expect(result).toMatchObject({
      kind: 'actual',
      timestamp: Date.UTC(2026, 1, 11, 11, 58, 0),
      timeText: '11:58',
      text: '已于 11:58 到点',
    });
  });

  it('returns null for countup blocks', () => {
    const result = resolveCountdownEndTimeDisplay({
      block: createCountdownBlock({
        mode: 'countup',
        targetMinutes: undefined,
        elapsed: 1234,
      }),
      now,
      ...formatOptions,
    });

    expect(result).toBeNull();
  });
});
