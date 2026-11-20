import { describe, expect, it } from 'vitest';
import {
  resolveBetaPeriodWindow,
  shiftBetaPeriodAnchor,
} from '@/beta/period-window';

const utc = (value: string) => Date.parse(value);

describe('Beta calendar period windows', () => {
  it('uses a Monday calendar week across a year boundary', () => {
    expect(
      resolveBetaPeriodWindow(utc('2026-01-01T12:00:00.000Z'), 'week', 'UTC'),
    ).toMatchObject({
      from_ms: utc('2025-12-29T00:00:00.000Z'),
      to_ms: utc('2026-01-05T00:00:00.000Z'),
    });
  });

  it('uses calendar month boundaries across a year boundary', () => {
    expect(
      resolveBetaPeriodWindow(utc('2025-12-15T12:00:00.000Z'), 'month', 'UTC'),
    ).toMatchObject({
      from_ms: utc('2025-12-01T00:00:00.000Z'),
      to_ms: utc('2026-01-01T00:00:00.000Z'),
    });
  });

  it('builds a 23-hour local day across the New York spring DST change', () => {
    const window = resolveBetaPeriodWindow(
      utc('2026-03-08T12:00:00.000Z'),
      'day',
      'America/New_York',
    );

    expect(window.from_ms).toBe(utc('2026-03-08T05:00:00.000Z'));
    expect(window.to_ms).toBe(utc('2026-03-09T04:00:00.000Z'));
    expect(window.to_ms - window.from_ms).toBe(23 * 60 * 60 * 1000);
  });

  it('builds a 25-hour local day across the New York fall DST change', () => {
    const window = resolveBetaPeriodWindow(
      utc('2026-11-01T12:00:00.000Z'),
      'day',
      'America/New_York',
    );

    expect(window.from_ms).toBe(utc('2026-11-01T04:00:00.000Z'));
    expect(window.to_ms).toBe(utc('2026-11-02T05:00:00.000Z'));
    expect(window.to_ms - window.from_ms).toBe(25 * 60 * 60 * 1000);
  });

  it('advances a month by local calendar date across a year boundary', () => {
    expect(
      shiftBetaPeriodAnchor(
        utc('2025-12-31T12:00:00.000Z'),
        'month',
        1,
        'UTC',
      ),
    ).toBe(utc('2026-01-31T12:00:00.000Z'));
  });

  it('uses the operating system local time zone when none is supplied', () => {
    const anchor = utc('2026-05-17T15:30:00.000Z');
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(resolveBetaPeriodWindow(anchor, 'day')).toEqual(
      resolveBetaPeriodWindow(anchor, 'day', localZone),
    );
  });
});
