import { describe, expect, it } from 'vitest';
import {
  isFocusPageCountdownOwner,
  resolveTimeblockEndAlertSyncDecision,
  shouldAutoOpenFocusOnTimeblockEnd,
} from '@/ui/app/components/TimeblockEndAlertCoordinator';
import type { TimeblockEndAlertRequest } from '@/lib/timeblock/end-alert-policy';

const REQUEST: TimeblockEndAlertRequest = {
  startId: 'timeblock-end-alert-running',
  title: 'Deep Work',
  dueAt: Date.UTC(2026, 3, 16, 2, 25, 0),
  soundEnabled: true,
  autoOpenFocus: false,
};

describe('TimeblockEndAlertCoordinator helpers', () => {
  it('treats only /eventlog as the visible focus countdown owner', () => {
    expect(isFocusPageCountdownOwner('/eventlog', '', false)).toBe(true);
    expect(isFocusPageCountdownOwner('/eventlog/timeblocks/block-1', '', false)).toBe(false);
    expect(isFocusPageCountdownOwner('/eventlog/record', '', false)).toBe(false);
    expect(isFocusPageCountdownOwner('/eventlog', '', true)).toBe(false);
  });

  it('only auto-opens focus when the app is actually backgrounded', () => {
    expect(shouldAutoOpenFocusOnTimeblockEnd(true, true)).toBe(true);
    expect(shouldAutoOpenFocusOnTimeblockEnd(true, false)).toBe(false);
    expect(shouldAutoOpenFocusOnTimeblockEnd(false, true)).toBe(false);
  });

  it('skips runtime sync until the active block state has been hydrated', () => {
    expect(resolveTimeblockEndAlertSyncDecision(true, false, null)).toEqual({
      kind: 'skip',
    });
  });

  it('cancels only after hydration confirms there is no desired alert', () => {
    expect(resolveTimeblockEndAlertSyncDecision(true, true, null)).toEqual({
      kind: 'cancel',
    });
  });

  it('schedules when support, hydration, and a desired alert are all present', () => {
    expect(resolveTimeblockEndAlertSyncDecision(true, true, REQUEST)).toEqual({
      kind: 'schedule',
      request: REQUEST,
    });
  });
});
