import { describe, expect, it } from 'vitest';
import { resolvePrLockRunner } from '../../../Scripts/dev/worker-agent/lock.ts';

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
});
