import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskBackupServiceImpl,
  type TaskReplicationPullCursor,
} from './task-backup.service';

const runtimeTarget = {
  mode: 'external' as const,
  host: '127.0.0.1',
  port: 9124,
  authToken: 'secret-token',
};

describe('TaskBackupServiceImpl', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  let service: TaskBackupServiceImpl;

  beforeEach(() => {
    fetchImpl.mockReset();
    service = new TaskBackupServiceImpl({
      fetchImpl,
      resolveTarget: () => runtimeTarget,
    });
  });

  it('requests local task replication summary and scope grant reconcile with runtime auth', async () => {
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema_version: 1,
        scope_key: 'anonymous',
        task_count: 2,
        max_updated_at: 1234,
        revision_hash: 'hash-local',
        generated_at: 5678,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scope_key: 'anonymous',
        granted_peers: 3,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(service.getTaskReplicationSummary()).resolves.toEqual({
      schemaVersion: 1,
      scopeKey: 'anonymous',
      taskCount: 2,
      maxUpdatedAt: 1234,
      revisionHash: 'hash-local',
      generatedAt: 5678,
    });
    await expect(service.reconcileTaskScopeGrants()).resolves.toEqual({
      scopeKey: 'anonymous',
      grantedPeers: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [summaryInput, summaryInit] = fetchImpl.mock.calls[0] ?? [];
    expect(summaryInput).toBe('http://127.0.0.1:9124/tasks/replication/summary?user_id=anonymous');
    expect(summaryInit?.method).toBeUndefined();
    const summaryHeaders = new Headers(summaryInit?.headers);
    expect(summaryHeaders.get('Accept')).toBe('application/json');
    expect(summaryHeaders.get('Authorization')).toBe('Bearer secret-token');

    const [grantInput, grantInit] = fetchImpl.mock.calls[1] ?? [];
    expect(grantInput).toBe('http://127.0.0.1:9124/mesh/tasks/grants/reconcile?user_id=anonymous');
    expect(grantInit?.method).toBe('POST');
    const grantHeaders = new Headers(grantInit?.headers);
    expect(grantHeaders.get('Accept')).toBe('application/json');
    expect(grantHeaders.get('Authorization')).toBe('Bearer secret-token');
  });

  it('requests peer summary, pull, and sqlite snapshot through local mesh proxy routes', async () => {
    const cursor: TaskReplicationPullCursor = {
      kind: 'task_watermark',
      updatedAt: 2222,
      taskId: 'task-2',
    };

    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema_version: 1,
        scope_key: 'anonymous',
        task_count: 4,
        max_updated_at: 2222,
        revision_hash: 'hash-peer',
        generated_at: 8888,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema_version: 1,
        scope_key: 'anonymous',
        items: [{
          id: 'task-3',
          title: 'Peer task',
          status: 'pending',
          priority: 'medium',
          created_at: 1111,
          updated_at: 3333,
          depends_on: [],
          time_block_ids: [],
        }],
        next_cursor: {
          kind: 'task_watermark',
          updated_at: 3333,
          task_id: 'task-3',
        },
        has_more: true,
        summary: {
          schema_version: 1,
          scope_key: 'anonymous',
          task_count: 4,
          max_updated_at: 3333,
          revision_hash: 'hash-peer-pull',
          generated_at: 9999,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 1,
        file_name: 'peer-tasks.sqlite',
        content_base64: 'AQID',
        task_count: 4,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(service.getPeerTaskReplicationSummary('peer-1')).resolves.toMatchObject({
      scopeKey: 'anonymous',
      taskCount: 4,
      revisionHash: 'hash-peer',
    });
    await expect(service.pullPeerTaskReplicationBatch('peer-1', cursor, 50)).resolves.toEqual({
      schemaVersion: 1,
      scopeKey: 'anonymous',
      items: [{
        id: 'task-3',
        title: 'Peer task',
        status: 'pending',
        priority: 'medium',
        created_at: 1111,
        updated_at: 3333,
        depends_on: [],
        time_block_ids: [],
      }],
      nextCursor: {
        kind: 'task_watermark',
        updatedAt: 3333,
        taskId: 'task-3',
      },
      hasMore: true,
      summary: {
        schemaVersion: 1,
        scopeKey: 'anonymous',
        taskCount: 4,
        maxUpdatedAt: 3333,
        revisionHash: 'hash-peer-pull',
        generatedAt: 9999,
      },
    });
    await expect(service.exportPeerTasksAsSqliteSnapshot('peer-1')).resolves.toEqual({
      fileName: 'peer-tasks.sqlite',
      bytes: Uint8Array.from([1, 2, 3]),
      taskCount: 4,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const [summaryInput, summaryInit] = fetchImpl.mock.calls[0] ?? [];
    expect(summaryInput).toBe('http://127.0.0.1:9124/mesh/peers/peer-1/tasks/summary?user_id=anonymous');
    expect(new Headers(summaryInit?.headers).get('Authorization')).toBe('Bearer secret-token');

    const [pullInput, pullInit] = fetchImpl.mock.calls[1] ?? [];
    const pullUrl = new URL(String(pullInput));
    expect(pullUrl.origin + pullUrl.pathname).toBe('http://127.0.0.1:9124/mesh/peers/peer-1/tasks/pull');
    expect(pullUrl.searchParams.get('after_updated_at')).toBe('2222');
    expect(pullUrl.searchParams.get('after_task_id')).toBe('task-2');
    expect(pullUrl.searchParams.get('limit')).toBe('50');
    expect(pullUrl.searchParams.get('user_id')).toBe('anonymous');
    expect(new Headers(pullInit?.headers).get('Authorization')).toBe('Bearer secret-token');

    const [snapshotInput, snapshotInit] = fetchImpl.mock.calls[2] ?? [];
    expect(snapshotInput).toBe('http://127.0.0.1:9124/mesh/peers/peer-1/tasks/snapshot/sqlite?user_id=anonymous');
    expect(new Headers(snapshotInit?.headers).get('Authorization')).toBe('Bearer secret-token');
  });
});
