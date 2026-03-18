import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractLatestActiveLockFromComments,
  normalizeRemoteLockMetadata,
  resolvePrLockRunner,
} from '../../../Scripts/dev/worker-agent/lock.ts';

describe('worker-agent lock runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:10:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to npx tsx when bun is unavailable', () => {
    const runner = resolvePrLockRunner((command) => command === 'npx');

    expect(runner).toEqual({
      command: 'npx',
      argsPrefix: ['tsx'],
    });
  });

  it('prefers bun when bun is available', () => {
    const runner = resolvePrLockRunner((command) => command === 'bun');

    expect(runner).toEqual({
      command: 'bun',
      argsPrefix: [],
    });
  });

  it('normalizes latest pr-lock metadata with computed expiry information', () => {
    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-1',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      lock_duration_minutes: 30,
      branch: 'feature/issue-421-worker-agent',
    });

    expect(lock?.lock_id).toBe('lock-1');
    expect(lock?.lock_duration_minutes).toBe(30);
    expect(lock?.expires_at).toBe('2026-03-10T00:30:00.000Z');
  });

  it('keeps compatibility with legacy timeout_minutes metadata', () => {
    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-legacy',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      timeout_minutes: 15,
      expires_at: '2026-03-10T00:15:00.000Z',
    });

    expect(lock?.lock_duration_minutes).toBe(15);
    expect(lock?.expires_at).toBe('2026-03-10T00:15:00.000Z');
  });

  it('ignores released lock metadata', () => {
    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-released',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      lock_duration_minutes: 15,
      released: true,
    });

    expect(lock).toBeNull();
  });

  it('ignores pending lock metadata', () => {
    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-pending',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      lock_duration_minutes: 15,
      pending: true,
    });

    expect(lock).toBeNull();
  });

  it('ignores expired lock metadata when its computed duration has elapsed', () => {
    vi.setSystemTime(new Date('2026-03-10T00:31:00.000Z'));

    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-expired-computed',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      lock_duration_minutes: 30,
    });

    expect(lock).toBeNull();
  });

  it('ignores expired lock metadata when explicit expiry is already in the past', () => {
    vi.setSystemTime(new Date('2026-03-10T00:16:00.000Z'));

    const lock = normalizeRemoteLockMetadata({
      lock_id: 'lock-expired-explicit',
      agent_id: 'worker-1',
      acquired_at: '2026-03-10T00:00:00.000Z',
      timeout_minutes: 15,
      expires_at: '2026-03-10T00:15:00.000Z',
    });

    expect(lock).toBeNull();
  });

  it('returns the newest active lock when a newer released loser comment exists', () => {
    const lock = extractLatestActiveLockFromComments([
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"winner","agent_id":"worker-1","acquired_at":"2026-03-10T00:00:00.000Z","lock_duration_minutes":30}\n-->',
      },
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"loser","agent_id":"worker-2","acquired_at":"2026-03-10T00:00:05.000Z","lock_duration_minutes":30,"released":true}\n-->',
      },
    ]);

    expect(lock?.lock_id).toBe('winner');
  });

  it('returns the newest active lock when a newer pending comment exists', () => {
    const lock = extractLatestActiveLockFromComments([
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"confirmed","agent_id":"worker-1","acquired_at":"2026-03-10T00:00:00.000Z","lock_duration_minutes":30}\n-->',
      },
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"pending","agent_id":"worker-1","acquired_at":"2026-03-10T00:00:05.000Z","lock_duration_minutes":30,"pending":true}\n-->',
      },
    ]);

    expect(lock?.lock_id).toBe('confirmed');
  });

  it('returns the newest unexpired lock when a newer expired comment exists', () => {
    vi.setSystemTime(new Date('2026-03-10T00:20:00.000Z'));

    const lock = extractLatestActiveLockFromComments([
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"active","agent_id":"worker-1","acquired_at":"2026-03-10T00:00:00.000Z","lock_duration_minutes":30}\n-->',
      },
      {
        body: '<!-- LOCK_METADATA\n{"lock_id":"expired","agent_id":"worker-2","acquired_at":"2026-03-10T00:00:05.000Z","lock_duration_minutes":1}\n-->',
      },
    ]);

    expect(lock?.lock_id).toBe('active');
  });
});
