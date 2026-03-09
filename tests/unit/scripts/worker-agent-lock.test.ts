import { describe, expect, it } from 'vitest';
import {
  normalizeRemoteLockMetadata,
  resolvePrLockRunner,
} from '../../../Scripts/dev/worker-agent/lock.ts';

describe('worker-agent lock runner', () => {
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
});
