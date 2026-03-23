import { describe, expect, it } from 'vitest';
import { buildSyncErrorLog, getSyncErrorDetails } from '@/lib/storage/sync-error';

describe('sync error classifier', () => {
  it('marks ECONNREFUSED as connection failure', () => {
    const details = getSyncErrorDetails({
      name: 'unknown',
      message: 'connect ECONNREFUSED 127.0.0.1:6984',
      status: 0,
    });
    expect(details.isConnectionFailure).toBe(true);
    expect(details.code).toBe('ECONNREFUSED');
  });

  it('marks Failed to fetch as connection failure', () => {
    const details = getSyncErrorDetails(new TypeError('Failed to fetch'));
    expect(details.isConnectionFailure).toBe(true);
    expect(details.code).toBe('FAILED_TO_FETCH');
  });

  it('builds readable log payload for connection failure', () => {
    const [message, payload] = buildSyncErrorLog(
      'EventStorage',
      'http://localhost:6984/2',
      new TypeError('Failed to fetch')
    );

    expect(message).toContain('连接失败');
    expect(payload.remoteUrl).toBe('http://localhost:6984/2');
    expect(payload.suggestion).toContain('同步服务进程');
  });
});
