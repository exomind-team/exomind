import { describe, expect, it } from 'vitest';
import { isFocusKeepAwakeEligibleBlock } from '@/ui/app/components/FocusKeepAwakeController';
import type { ActiveBlockData } from '@/lib/types/event';

function buildBlock(phase: ActiveBlockData['phase']): ActiveBlockData {
  return {
    startId: `focus-keep-awake-${phase}`,
    name: 'Focus',
    startTime: Date.UTC(2026, 3, 16, 3, 0, 0),
    mode: 'countdown',
    targetMinutes: 25,
    phase,
    paused: phase === 'paused',
    transitions: [{ type: 'start', at: Date.UTC(2026, 3, 16, 3, 0, 0) }],
  };
}

describe('isFocusKeepAwakeEligibleBlock', () => {
  it('keeps awake only for running or paused focus blocks', () => {
    expect(isFocusKeepAwakeEligibleBlock(buildBlock('running'))).toBe(true);
    expect(isFocusKeepAwakeEligibleBlock(buildBlock('paused'))).toBe(true);
    expect(isFocusKeepAwakeEligibleBlock(buildBlock('feedback_in_progress'))).toBe(false);
    expect(isFocusKeepAwakeEligibleBlock(buildBlock('feedback_submitted'))).toBe(false);
  });

  it('rejects gap blocks', () => {
    expect(isFocusKeepAwakeEligibleBlock({
      ...buildBlock('running'),
      blockType: 'gap',
    })).toBe(false);
  });
});
