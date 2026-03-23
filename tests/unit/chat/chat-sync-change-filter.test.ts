import { describe, expect, it } from 'vitest';
import { shouldSkipSyncRefresh } from '@/components/Chat/chat-sync-change-filter';

describe('chat-sync-change-filter', () => {
  it('does not skip local event changes (pure web should refresh)', () => {
    expect(shouldSkipSyncRefresh({
      type: 'local',
      doc: { _id: 'event:1' },
    })).toBe(false);
  });

  it('skips sync push echo changes', () => {
    expect(shouldSkipSyncRefresh({
      direction: 'push',
      change: { docs: [{ _id: 'event:2' }] },
    })).toBe(true);
  });

  it('skips checkpoint-only changes', () => {
    expect(shouldSkipSyncRefresh({
      direction: 'pull',
      change: { docs: [{ _id: '_local/checkpoint' }] },
    })).toBe(true);
  });

  it('does not skip pull changes with real event docs', () => {
    expect(shouldSkipSyncRefresh({
      direction: 'pull',
      change: { docs: [{ _id: 'event:3' }] },
    })).toBe(false);
  });
});
