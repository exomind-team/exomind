import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { deferred } from './fixtures';
import { D, P, activeSnapshot, timeblockClient } from './timeblock-fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

afterEach(() => vi.useRealTimers());
describe('B12-07: the timeblock data owner outlives every presentation', () => {
  it('observes and recovers a failed read without any mounted view or synthetic command', async () => {
    vi.useFakeTimers();
    const client = timeblockClient(); client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
    const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(owner.snapshot().remote?.active?.phase).toBe('running');
      client.timeblocks.snapshot.mockRejectedValueOnce(new Error('synthetic read failure'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(owner.snapshot().error).toBe('synthetic read failure');
      expect(owner.snapshot().remote?.active?.phase).toBe('running');
      client.timeblocks.snapshot.mockResolvedValue({ ...activeSnapshot(), active: { ...activeSnapshot().active!, phase: 'paused', deadline: null } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(owner.snapshot().error).toBeNull();
      expect(owner.snapshot().remote?.active?.phase).toBe('paused');
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    } finally { await owner.close(); }
  });

  it('never overlaps its periodic reads or resurrects after close during a pending read', async () => {
    vi.useFakeTimers();
    const client = timeblockClient(), gate = deferred<ReturnType<typeof activeSnapshot>>();
    client.timeblocks.snapshot.mockReturnValue(gate.promise);
    const owner = await BetaTimeblockController.open(client, D, P, { journal: memoryIntentJournal() });
    const changed = vi.fn(); owner.subscribe(changed);
    try {
      await vi.advanceTimersByTimeAsync(6000);
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(1);
      await owner.close(); const calls = changed.mock.calls.length;
      gate.resolve(activeSnapshot());
      await vi.advanceTimersByTimeAsync(6000);
      expect(owner.snapshot().remote).toBeNull();
      expect(changed).toHaveBeenCalledTimes(calls);
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(1);
      expect(client.timeblocks.command).not.toHaveBeenCalled();
    } finally { gate.resolve(activeSnapshot()); await owner.close(); }
  });
});
