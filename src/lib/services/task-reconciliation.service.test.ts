import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTaskPayload } from "@/lib/adapters/task-rt-adapter";
import type {
  TaskImportResult,
  TaskReplicationPullCursor,
  TaskReplicationPullResult,
  TaskReplicationSummary,
} from "./task-backup.service";
import { TaskReconciliationService } from "./task-reconciliation.service";

function createSummary(
  overrides: Partial<TaskReplicationSummary> = {},
): TaskReplicationSummary {
  return {
    schemaVersion: 1,
    scopeKey: "anonymous",
    taskCount: 1,
    maxUpdatedAt: 100,
    revisionHash: "hash-a",
    generatedAt: 999,
    ...overrides,
  };
}

function createRuntimeTask(
  overrides: Partial<RuntimeTaskPayload> = {},
): RuntimeTaskPayload {
  return {
    id: "task-1",
    title: "Replicated task",
    status: "pending",
    priority: "medium",
    tags: [],
    depends_on: [],
    time_block_ids: [],
    status_transitions: [
      {
        id: "task-1:task.create:10",
        at: 10,
        from_status: null,
        to_status: "pending",
        reason: "task.create",
      },
    ],
    created_at: 10,
    updated_at: 100,
    ...overrides,
  };
}

function createPullResult(
  overrides: Partial<TaskReplicationPullResult> = {},
): TaskReplicationPullResult {
  return {
    schemaVersion: 1,
    scopeKey: "anonymous",
    items: [createRuntimeTask()],
    hasMore: false,
    summary: createSummary({ maxUpdatedAt: 200, revisionHash: "hash-b" }),
    ...overrides,
  };
}

describe("TaskReconciliationService", () => {
  const taskBackupService = {
    exportPeerTasksAsSqliteSnapshot: vi.fn(),
    getPeerTaskReplicationSummary: vi.fn(),
    getTaskReplicationSummary: vi.fn(),
    importTasksFromSqliteSnapshot: vi.fn(),
    pullPeerTaskReplicationBatch: vi.fn(),
    reconcileTaskScopeGrants: vi.fn(),
  };
  const taskRtAdapter = {
    applyReplicationSnapshot: vi.fn(),
  };
  let service: TaskReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaskReconciliationService({
      taskBackupService,
      taskRtAdapter,
      pullBatchLimit: 50,
    });
  });

  it("skips reconciliation when local and remote summaries already match", async () => {
    const summary = createSummary();
    taskBackupService.getTaskReplicationSummary.mockResolvedValue(summary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(summary);

    const result = await service.reconcilePeer("peer-1");

    expect(result).toMatchObject({
      peerId: "peer-1",
      changed: false,
      unresolvedDrift: false,
      strategy: "noop",
      imported: 0,
      skipped: 0,
      total: 0,
    });
    expect(
      taskBackupService.pullPeerTaskReplicationBatch,
    ).not.toHaveBeenCalled();
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).not.toHaveBeenCalled();
    expect(taskRtAdapter.applyReplicationSnapshot).not.toHaveBeenCalled();
  });

  it("fails closed on scope mismatch before attempting auto-repair", async () => {
    taskBackupService.getTaskReplicationSummary.mockResolvedValue(
      createSummary({
        scopeKey: "profile-local",
        revisionHash: "hash-local",
      }),
    );
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      createSummary({
        scopeKey: "profile-remote",
        maxUpdatedAt: 200,
        revisionHash: "hash-remote",
      }),
    );

    const result = await service.reconcilePeer("peer-2");

    expect(result).toMatchObject({
      peerId: "peer-2",
      changed: false,
      unresolvedDrift: true,
      strategy: "unresolved",
    });
    expect(
      taskBackupService.pullPeerTaskReplicationBatch,
    ).not.toHaveBeenCalled();
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("pulls remote pages and converges without snapshot fallback when remote is newer", async () => {
    const localSummary = createSummary();
    const remoteSummary = createSummary({
      taskCount: 2,
      maxUpdatedAt: 300,
      revisionHash: "hash-remote",
    });
    const nextCursor: TaskReplicationPullCursor = {
      kind: "task_watermark",
      updatedAt: 200,
      taskId: "task-2",
    };

    taskBackupService.getTaskReplicationSummary
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(remoteSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );
    taskBackupService.pullPeerTaskReplicationBatch
      .mockResolvedValueOnce(
        createPullResult({
          items: [createRuntimeTask({ id: "task-1", updated_at: 200 })],
          hasMore: true,
          nextCursor,
        }),
      )
      .mockResolvedValueOnce(
        createPullResult({
          items: [createRuntimeTask({ id: "task-2", updated_at: 300 })],
          hasMore: false,
          nextCursor: undefined,
        }),
      );
    taskRtAdapter.applyReplicationSnapshot
      .mockResolvedValueOnce("inserted")
      .mockResolvedValueOnce("updated");

    const result = await service.reconcilePeer("peer-3");

    expect(result).toMatchObject({
      peerId: "peer-3",
      changed: true,
      unresolvedDrift: false,
      strategy: "pull",
      imported: 2,
      skipped: 0,
      total: 2,
    });
    expect(
      taskBackupService.pullPeerTaskReplicationBatch,
    ).toHaveBeenNthCalledWith(1, "peer-3", undefined, 50);
    expect(
      taskBackupService.pullPeerTaskReplicationBatch,
    ).toHaveBeenNthCalledWith(2, "peer-3", nextCursor, 50);
    expect(taskRtAdapter.applyReplicationSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "task-1" }),
      "peer-3",
    );
    expect(taskRtAdapter.applyReplicationSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "task-2" }),
      "peer-3",
    );
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("falls back to sqlite snapshot when pull does not converge", async () => {
    const localSummary = createSummary();
    const remoteSummary = createSummary({
      taskCount: 2,
      maxUpdatedAt: 300,
      revisionHash: "hash-remote",
    });
    const stillDriftingLocal = createSummary({
      taskCount: 1,
      maxUpdatedAt: 250,
      revisionHash: "hash-after-pull",
    });
    const snapshotImport: TaskImportResult = {
      imported: 3,
      skipped: 1,
      total: 4,
    };

    taskBackupService.getTaskReplicationSummary
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(stillDriftingLocal)
      .mockResolvedValueOnce(remoteSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );
    taskBackupService.pullPeerTaskReplicationBatch.mockResolvedValue(
      createPullResult({
        items: [createRuntimeTask({ id: "task-9", updated_at: 300 })],
        hasMore: false,
        nextCursor: undefined,
        summary: remoteSummary,
      }),
    );
    taskRtAdapter.applyReplicationSnapshot.mockResolvedValue("updated");
    taskBackupService.exportPeerTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: "peer.sqlite",
      bytes: Uint8Array.from([1, 2, 3]),
      taskCount: 2,
    });
    taskBackupService.importTasksFromSqliteSnapshot.mockResolvedValue(
      snapshotImport,
    );

    const result = await service.reconcilePeer("peer-4");

    expect(result).toMatchObject({
      peerId: "peer-4",
      changed: true,
      unresolvedDrift: false,
      strategy: "pull_then_snapshot",
      imported: 4,
      skipped: 1,
      total: 5,
    });
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).toHaveBeenCalledWith("peer-4");
    expect(
      taskBackupService.importTasksFromSqliteSnapshot,
    ).toHaveBeenCalledWith(Uint8Array.from([1, 2, 3]), "merge");
  });

  it("treats updates-only snapshot convergence as a local change", async () => {
    const localSummary = createSummary({
      taskCount: 1,
      maxUpdatedAt: 100,
      revisionHash: "hash-local",
    });
    const remoteSummary = createSummary({
      taskCount: 1,
      maxUpdatedAt: 300,
      revisionHash: "hash-remote",
    });

    taskBackupService.getTaskReplicationSummary
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(remoteSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );
    taskBackupService.pullPeerTaskReplicationBatch.mockResolvedValue(
      createPullResult({
        items: [],
        hasMore: false,
        nextCursor: undefined,
        summary: remoteSummary,
      }),
    );
    taskBackupService.exportPeerTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: "peer.sqlite",
      bytes: Uint8Array.from([4, 5, 6]),
      taskCount: 1,
    });
    taskBackupService.importTasksFromSqliteSnapshot.mockResolvedValue({
      imported: 0,
      skipped: 1,
      total: 1,
    });

    const result = await service.reconcilePeer("peer-snapshot-update");

    expect(result).toMatchObject({
      peerId: "peer-snapshot-update",
      changed: true,
      unresolvedDrift: false,
      strategy: "pull_then_snapshot",
      imported: 0,
      skipped: 1,
      total: 1,
    });
  });

  it("marks unresolved drift when remote differs but is not newer", async () => {
    const localSummary = createSummary({
      taskCount: 3,
      maxUpdatedAt: 500,
      revisionHash: "hash-local",
    });
    const remoteSummary = createSummary({
      taskCount: 2,
      maxUpdatedAt: 499,
      revisionHash: "hash-remote",
    });

    taskBackupService.getTaskReplicationSummary.mockResolvedValue(localSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );

    const result = await service.reconcilePeer("peer-5");

    expect(result).toMatchObject({
      peerId: "peer-5",
      changed: false,
      unresolvedDrift: true,
      strategy: "unresolved",
      imported: 0,
      skipped: 0,
      total: 0,
    });
    expect(
      taskBackupService.pullPeerTaskReplicationBatch,
    ).not.toHaveBeenCalled();
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("attempts pull when revision hash differs at the same watermark", async () => {
    const localSummary = createSummary({
      maxUpdatedAt: 500,
      revisionHash: "hash-local",
    });
    const remoteSummary = createSummary({
      maxUpdatedAt: 500,
      revisionHash: "hash-remote-same-watermark",
    });

    taskBackupService.getTaskReplicationSummary
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(remoteSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );
    taskBackupService.pullPeerTaskReplicationBatch.mockResolvedValue(
      createPullResult({
        items: [
          createRuntimeTask({ id: "task-same-watermark", updated_at: 500 }),
        ],
        hasMore: false,
        nextCursor: undefined,
        summary: remoteSummary,
      }),
    );
    taskRtAdapter.applyReplicationSnapshot.mockResolvedValue("updated");

    const result = await service.reconcilePeer("peer-same-watermark");

    expect(result).toMatchObject({
      peerId: "peer-same-watermark",
      changed: true,
      unresolvedDrift: false,
      strategy: "pull",
      imported: 1,
      skipped: 0,
      total: 1,
    });
    expect(taskBackupService.pullPeerTaskReplicationBatch).toHaveBeenCalled();
  });

  it("keeps unresolved drift when remote is newer but represents deletions we cannot auto-merge", async () => {
    const localSummary = createSummary({
      taskCount: 3,
      maxUpdatedAt: 100,
      revisionHash: "hash-local",
    });
    const remoteSummary = createSummary({
      taskCount: 2,
      maxUpdatedAt: 300,
      revisionHash: "hash-remote-delete",
    });

    taskBackupService.getTaskReplicationSummary
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(localSummary)
      .mockResolvedValueOnce(localSummary);
    taskBackupService.getPeerTaskReplicationSummary.mockResolvedValue(
      remoteSummary,
    );
    taskBackupService.pullPeerTaskReplicationBatch.mockResolvedValue(
      createPullResult({
        items: [],
        hasMore: false,
        nextCursor: undefined,
        summary: remoteSummary,
      }),
    );
    taskBackupService.exportPeerTasksAsSqliteSnapshot.mockResolvedValue({
      fileName: "peer.sqlite",
      bytes: Uint8Array.from([]),
      taskCount: 2,
    });
    taskBackupService.importTasksFromSqliteSnapshot.mockResolvedValue({
      imported: 0,
      skipped: 0,
      total: 0,
    });

    const result = await service.reconcilePeer("peer-delete");

    expect(result).toMatchObject({
      peerId: "peer-delete",
      changed: false,
      unresolvedDrift: true,
      strategy: "unresolved",
      imported: 0,
      skipped: 0,
      total: 0,
    });
    expect(
      taskBackupService.exportPeerTasksAsSqliteSnapshot,
    ).toHaveBeenCalledWith("peer-delete");
  });
});
