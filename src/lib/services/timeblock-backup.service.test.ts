import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockBackupServiceImpl } from './timeblock-backup.service';

const runtimeTarget = {
  mode: 'external' as const,
  host: '127.0.0.1',
  port: 9124,
  authToken: 'secret-token',
};

describe('TimeBlockBackupServiceImpl', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  let service: TimeBlockBackupServiceImpl;

  beforeEach(() => {
    fetchImpl.mockReset();
    service = new TimeBlockBackupServiceImpl({
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
        file_name: 'peer-timeblocks.sqlite',
        content_base64: 'BAUG',
        timeblock_count: 3,
        active_block_present: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(service.reconcileTimeBlockScopeGrants()).resolves.toEqual({
      scopeKey: 'anonymous',
      grantedPeers: 2,
    });
    await expect(service.exportPeerTimeBlocksAsSqliteSnapshot('peer-1')).resolves.toEqual({
      fileName: 'peer-timeblocks.sqlite',
      bytes: Uint8Array.from([4, 5, 6]),
      timeBlockCount: 3,
      activeBlockPresent: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [grantInput, grantInit] = fetchImpl.mock.calls[0] ?? [];
    expect(grantInput).toBe('http://127.0.0.1:9124/mesh/timeblocks/grants/reconcile?user_id=anonymous');
    expect(grantInit?.method).toBe('POST');
    expect(new Headers(grantInit?.headers).get('Authorization')).toBe('Bearer secret-token');

    const [snapshotInput, snapshotInit] = fetchImpl.mock.calls[1] ?? [];
    expect(snapshotInput).toBe('http://127.0.0.1:9124/mesh/peers/peer-1/timeblocks/snapshot/sqlite?user_id=anonymous');
    expect(snapshotInit?.method).toBeUndefined();
    expect(new Headers(snapshotInit?.headers).get('Authorization')).toBe('Bearer secret-token');
  });
});
