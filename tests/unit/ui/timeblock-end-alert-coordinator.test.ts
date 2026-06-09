import { describe, expect, it } from 'vitest';
import {
  isFocusPageCountdownOwner,
  isTimeblockEndAlertRequestOverdue,
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

  it('does not treat an armed future request as fired yet', () => {
    const armedStartIds = new Set([REQUEST.startId]);

    expect(isTimeblockEndAlertRequestOverdue(
      REQUEST,
      Date.UTC(2026, 3, 16, 2, 24, 59),
    )).toBe(false);
    expect(resolveTimeblockEndAlertSyncDecision(true, true, REQUEST, {
      armedStartIds,
      now: Date.UTC(2026, 3, 16, 2, 24, 59),
    })).toEqual({
      kind: 'schedule',
      request: REQUEST,
    });
  });

  it('suppresses an already armed overdue request for the same time block', () => {
    const armedStartIds = new Set([REQUEST.startId]);

    expect(isTimeblockEndAlertRequestOverdue(
      REQUEST,
      Date.UTC(2026, 3, 16, 2, 25, 0),
    )).toBe(true);
    expect(resolveTimeblockEndAlertSyncDecision(true, true, REQUEST, {
      armedStartIds,
      now: Date.UTC(2026, 3, 16, 2, 25, 0),
    })).toEqual({
      kind: 'skip',
    });
  });

  it('still schedules the first overdue request when it has not been armed before', () => {
    expect(resolveTimeblockEndAlertSyncDecision(true, true, REQUEST, {
      armedStartIds: new Set(),
      now: Date.UTC(2026, 3, 16, 2, 26, 0),
    })).toEqual({
      kind: 'schedule',
      request: REQUEST,
    });
  });
});
