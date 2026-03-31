import { describe, it, expect } from 'vitest';
import type { BlockTransition } from '@/lib/types/event';
import {
  derivePhase,
  deriveIsPaused,
  deriveStartTime,
  deriveEndTime,
  deriveAccumulatedRunMs,
  derivePauseAccumulatedMs,
  deriveLastResumedAt,
} from '@/lib/timeblock/derive';

describe('#780 derive functions', () => {
  const T = (type: string, at: number): BlockTransition => ({ type: type as any, at });

  describe('derivePhase', () => {
    it('returns running for [start]', () => {
      expect(derivePhase([T('start', 1000)])).toBe('running');
    });
    it('returns paused for [start, pause]', () => {
      expect(derivePhase([T('start', 1000), T('pause', 2000)])).toBe('paused');
    });
    it('returns running for [start, pause, resume]', () => {
      expect(derivePhase([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe('running');
    });
    it('returns feedback for [start, feedback_start]', () => {
      expect(derivePhase([T('start', 1000), T('feedback_start', 5000)])).toBe('feedback');
    });
    it('returns completed for [..., feedback_submit, end]', () => {
      expect(derivePhase([T('start', 1000), T('feedback_start', 5000), T('feedback_submit', 6000), T('end', 6000)])).toBe('completed');
    });
    it('returns idle for empty transitions', () => {
      expect(derivePhase([])).toBe('idle');
    });
  });

  describe('deriveIsPaused', () => {
    it('false for [start]', () => expect(deriveIsPaused([T('start', 1000)])).toBe(false));
    it('true for [start, pause]', () => expect(deriveIsPaused([T('start', 1000), T('pause', 2000)])).toBe(true));
    it('false for [start, pause, resume]', () => expect(deriveIsPaused([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe(false));
  });

  describe('deriveStartTime / deriveEndTime', () => {
    it('startTime = transitions[0].at', () => expect(deriveStartTime([T('start', 1000)])).toBe(1000));
    it('startTime undefined for empty', () => expect(deriveStartTime([])).toBeUndefined());
    it('endTime = last end transition at', () => expect(deriveEndTime([T('start', 1000), T('end', 5000)])).toBe(5000));
    it('endTime undefined if no end', () => expect(deriveEndTime([T('start', 1000)])).toBeUndefined());
  });

  describe('deriveAccumulatedRunMs', () => {
    it('simple: start to now', () => expect(deriveAccumulatedRunMs([T('start', 1000)], 5000)).toBe(4000));
    it('with pause: start→pause→resume→now', () => {
      const tr = [T('start', 1000), T('pause', 3000), T('resume', 5000)];
      expect(deriveAccumulatedRunMs(tr, 7000)).toBe(4000);
    });
    it('currently paused: excludes current pause', () => {
      expect(deriveAccumulatedRunMs([T('start', 1000), T('pause', 3000)], 7000)).toBe(2000);
    });
    it('with feedback_start: stops counting', () => {
      expect(deriveAccumulatedRunMs([T('start', 1000), T('feedback_start', 5000)], 9000)).toBe(4000);
    });
    it('multiple pause/resume cycles', () => {
      const tr = [T('start', 0), T('pause', 100), T('resume', 200), T('pause', 400), T('resume', 500)];
      expect(deriveAccumulatedRunMs(tr, 600)).toBe(400); // 100 + 200 + 100
    });
  });

  describe('derivePauseAccumulatedMs', () => {
    it('no pause = 0', () => expect(derivePauseAccumulatedMs([T('start', 1000)], 5000)).toBe(0));
    it('pause→resume', () => {
      expect(derivePauseAccumulatedMs([T('start', 1000), T('pause', 3000), T('resume', 5000)], 7000)).toBe(2000);
    });
    it('currently paused: includes ongoing', () => {
      expect(derivePauseAccumulatedMs([T('start', 1000), T('pause', 3000)], 7000)).toBe(4000);
    });
  });

  describe('deriveLastResumedAt', () => {
    it('returns start time if never paused', () => expect(deriveLastResumedAt([T('start', 1000)])).toBe(1000));
    it('returns resume time after pause', () => {
      expect(deriveLastResumedAt([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe(3000);
    });
    it('undefined for empty', () => expect(deriveLastResumedAt([])).toBeUndefined());
  });
});
