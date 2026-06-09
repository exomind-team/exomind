import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLogBackupServiceImpl } from './eventlog-backup.service';

const runtimeTarget = {
  mode: 'external' as const,
  host: '127.0.0.1',
  port: 9124,
  authToken: 'secret-token',
};

describe('EventLogBackupServiceImpl', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  let service: EventLogBackupServiceImpl;

  beforeEach(() => {
    fetchImpl.mockReset();
    service = new EventLogBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => runtimeTarget,
    });
  });

  it('requests scope grant reconcile and peer sqlite snapshot through local mesh proxy routes', async () => {
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scope_key: 'anonymous',
        granted_peers: 2,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 1,
        file_name: 'peer-eventlog.sqlite',
        content_base64: 'AQID',
        event_count: 4,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(service.reconcileEventLogScopeGrants()).resolves.toEqual({
      scopeKey: 'anonymous',
      grantedPeers: 2,
    });
    await expect(service.exportPeerEventsAsSqliteSnapshot('peer-1')).resolves.toEqual({
      fileName: 'peer-eventlog.sqlite',
      bytes: Uint8Array.from([1, 2, 3]),
      eventCount: 4,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [grantInput, grantInit] = fetchImpl.mock.calls[0] ?? [];
    expect(grantInput).toBe('http://127.0.0.1:9124/mesh/eventlog/grants/reconcile?user_id=anonymous');
    expect(grantInit?.method).toBe('POST');
    expect(new Headers(grantInit?.headers).get('Authorization')).toBe('Bearer secret-token');

    const [snapshotInput, snapshotInit] = fetchImpl.mock.calls[1] ?? [];
    expect(snapshotInput).toBe('http://127.0.0.1:9124/mesh/peers/peer-1/eventlog/snapshot/sqlite?user_id=anonymous');
    expect(snapshotInit?.method).toBeUndefined();
    expect(new Headers(snapshotInit?.headers).get('Authorization')).toBe('Bearer secret-token');
  });
});
