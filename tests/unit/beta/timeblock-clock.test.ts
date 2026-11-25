import { describe, expect, it } from 'vitest';
import { timeblockClock } from '@/beta/timeblocks-controller';
import { activeSnapshot } from './timeblock-fixtures';

describe('Beta timeblock clock copy', () => {
  it('keeps the actual end time when the service has recalibrated the device clock', () => {
    const snapshot = activeSnapshot();
    snapshot.clock.wall_clock_moved_back = true;

    const clock = timeblockClock(snapshot, 0);

    expect(clock.endTimeText).toContain('预计');
    expect(clock.endTimeText).toContain('结束');
    expect(clock.endTimeText).not.toContain('以服务状态为准');
  });

  it('explains that a new end time is pending when recalibration has no deadline sample', () => {
    const snapshot = activeSnapshot();
    snapshot.clock.epoch_changed = true;
    snapshot.active = { ...snapshot.active!, deadline: null };

    expect(timeblockClock(snapshot, 0).endTimeText).toBe('正在校准时间，结束时间待确认');
  });
});
