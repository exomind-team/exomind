import { describe, it, expect } from 'vitest';
import { ConflictResolution, Conflict } from '../../src/lib/sync/conflict-resolution';
import { SyncMessage } from '../../src/lib/sync/websocket-client';

describe('ConflictResolution', () => {
  const resolver = new ConflictResolution();

  it('should resolve conflict with newer timestamp', () => {
    const conflict: Conflict = {
      entity: 'test',
      localChange: {
        type: 'CHANGE',
        payload: {},
        timestamp: 1000,
        deviceId: 'device-a',
      },
      remoteChange: {
        type: 'CHANGE',
        payload: {},
        timestamp: 2000,
        deviceId: 'device-b',
      },
    };
    const result = resolver.resolve(conflict);
    expect(result).toBe(conflict.remoteChange);
  });

  it('should use deviceId as tiebreaker when timestamps are equal', () => {
    const conflict: Conflict = {
      entity: 'test',
      localChange: {
        type: 'CHANGE',
        payload: {},
        timestamp: 1000,
        deviceId: 'device-b',
      },
      remoteChange: {
        type: 'CHANGE',
        payload: {},
        timestamp: 1000,
        deviceId: 'device-a',
      },
    };
    const result = resolver.resolve(conflict);
    expect(result).toBe(conflict.localChange);
  });
});
