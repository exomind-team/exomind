import {
  TaskRtAdapter,
  runtimeTaskPayloadToTaskNode,
} from '@/lib/adapters/task-rt-adapter';
import { log } from '@/lib/logger';
import {
  TaskBackupServiceImpl,
  type TaskImportResult,
  type TaskReplicationPullCursor,
  type TaskReplicationSummary,
  type TaskScopeGrantReconcileResult,
} from '@/lib/services/task-backup.service';

type TaskSummaryClient = Pick<
  TaskBackupServiceImpl,
  | 'exportPeerTasksAsSqliteSnapshot'
  | 'getPeerTaskReplicationSummary'
  | 'getTaskReplicationSummary'
  | 'importTasksFromSqliteSnapshot'
  | 'pullPeerTaskReplicationBatch'
  | 'reconcileTaskScopeGrants'
>;

type TaskReplicationApplier = Pick<TaskRtAdapter, 'applyReplicationSnapshot'>;

export interface TaskReconciliationServiceOptions {
  taskBackupService?: TaskSummaryClient;
  taskRtAdapter?: TaskReplicationApplier;
  pullBatchLimit?: number;
}

export interface TaskPeerReconciliationResult extends TaskImportResult {
  peerId: string;
  changed: boolean;
  unresolvedDrift: boolean;
  strategy: 'noop' | 'pull' | 'pull_then_snapshot' | 'unresolved';
  localSummary: TaskReplicationSummary;
  remoteSummary: TaskReplicationSummary;
}

const DEFAULT_PULL_BATCH_LIMIT = 200;

function createEmptyImportResult(): TaskImportResult {
  return { imported: 0, skipped: 0, total: 0 };
}

function mergeImportResults(
  left: TaskImportResult,
  right: TaskImportResult,
): TaskImportResult {
  return {
    imported: left.imported + right.imported,
    skipped: left.skipped + right.skipped,
    total: left.total + right.total,
  };
}

function areSummariesEqual(
  localSummary: TaskReplicationSummary,
  remoteSummary: TaskReplicationSummary,
): boolean {
  return (
    localSummary.taskCount === remoteSummary.taskCount
    && localSummary.maxUpdatedAt === remoteSummary.maxUpdatedAt
    && localSummary.revisionHash === remoteSummary.revisionHash
  );
}

function hasScopeMismatch(
  localSummary: TaskReplicationSummary,
  remoteSummary: TaskReplicationSummary,
): boolean {
  return localSummary.scopeKey !== remoteSummary.scopeKey;
}

function formatSummary(summary: TaskReplicationSummary): string {
  return `scope=${summary.scopeKey} count=${summary.taskCount} maxUpdatedAt=${summary.maxUpdatedAt} revision=${summary.revisionHash}`;
}

export class TaskReconciliationService {
  private readonly taskBackupService: TaskSummaryClient;
  private readonly taskRtAdapter: TaskReplicationApplier;
  private readonly pullBatchLimit: number;

  constructor(options: TaskReconciliationServiceOptions = {}) {
    this.taskBackupService = options.taskBackupService ?? new TaskBackupServiceImpl();
    this.taskRtAdapter = options.taskRtAdapter ?? new TaskRtAdapter();
    this.pullBatchLimit = options.pullBatchLimit ?? DEFAULT_PULL_BATCH_LIMIT;
  }

  async reconcileScopeGrants(): Promise<TaskScopeGrantReconcileResult> {
    return this.taskBackupService.reconcileTaskScopeGrants();
  }

  async reconcilePeer(peerId: string): Promise<TaskPeerReconciliationResult> {
    const localSummary = await this.taskBackupService.getTaskReplicationSummary();
    const remoteSummary = await this.taskBackupService.getPeerTaskReplicationSummary(peerId);

    if (hasScopeMismatch(localSummary, remoteSummary)) {
      log.warn(
        `[TaskReconciliation] scope mismatch, skip auto-repair: peer=${peerId} local=${formatSummary(localSummary)} remote=${formatSummary(remoteSummary)}`,
      );
      return {
        ...createEmptyImportResult(),
        peerId,
        changed: false,
        unresolvedDrift: true,
        strategy: 'unresolved',
        localSummary,
        remoteSummary,
      };
    }

    if (areSummariesEqual(localSummary, remoteSummary)) {
      return {
        ...createEmptyImportResult(),
        peerId,
        changed: false,
        unresolvedDrift: false,
        strategy: 'noop',
        localSummary,
        remoteSummary,
      };
    }

    if (remoteSummary.maxUpdatedAt < localSummary.maxUpdatedAt) {
      log.warn(
        `[TaskReconciliation] drift detected but remote is not newer; keep local state: peer=${peerId} local=${formatSummary(localSummary)} remote=${formatSummary(remoteSummary)}`,
      );
      return {
        ...createEmptyImportResult(),
        peerId,
        changed: false,
        unresolvedDrift: true,
        strategy: 'unresolved',
        localSummary,
        remoteSummary,
      };
    }

    let pullImport = createEmptyImportResult();
    try {
      pullImport = await this.pullPeerTasks(peerId);
    } catch (error) {
      log.warn(
        `[TaskReconciliation] peer pull failed, fallback to snapshot: peer=${peerId} ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let currentLocalSummary = await this.taskBackupService.getTaskReplicationSummary();
    if (areSummariesEqual(currentLocalSummary, remoteSummary)) {
      return {
        ...pullImport,
        peerId,
        changed: pullImport.imported > 0,
        unresolvedDrift: false,
        strategy: 'pull',
        localSummary: currentLocalSummary,
        remoteSummary,
      };
    }

    const beforeSnapshotSummary = currentLocalSummary;
    const snapshot = await this.taskBackupService.exportPeerTasksAsSqliteSnapshot(peerId);
    const snapshotImport = await this.taskBackupService.importTasksFromSqliteSnapshot(
      snapshot.bytes,
      'merge',
    );
    currentLocalSummary = await this.taskBackupService.getTaskReplicationSummary();
    const combinedImport = mergeImportResults(pullImport, snapshotImport);
    const snapshotChanged = !areSummariesEqual(beforeSnapshotSummary, currentLocalSummary);

    if (areSummariesEqual(currentLocalSummary, remoteSummary)) {
      return {
        ...combinedImport,
        peerId,
        changed: pullImport.imported > 0 || snapshotChanged,
        unresolvedDrift: false,
        strategy: 'pull_then_snapshot',
        localSummary: currentLocalSummary,
        remoteSummary,
      };
    }

    log.warn(
      `[TaskReconciliation] unresolved drift after snapshot fallback: peer=${peerId} local=${formatSummary(currentLocalSummary)} remote=${formatSummary(remoteSummary)}`,
    );
    return {
      ...combinedImport,
      peerId,
      changed: pullImport.imported > 0 || snapshotChanged,
      unresolvedDrift: true,
      strategy: 'unresolved',
      localSummary: currentLocalSummary,
      remoteSummary,
    };
  }

  private async pullPeerTasks(peerId: string): Promise<TaskImportResult> {
    let cursor: TaskReplicationPullCursor | undefined;
    let aggregate = createEmptyImportResult();

    while (true) {
      const batch = await this.taskBackupService.pullPeerTaskReplicationBatch(
        peerId,
        cursor,
        this.pullBatchLimit,
      );

      for (const runtimeTask of batch.items) {
        const result = await this.taskRtAdapter.applyReplicationSnapshot(
          runtimeTaskPayloadToTaskNode(runtimeTask),
          peerId,
        );
        aggregate = mergeImportResults(aggregate, {
          imported: result === 'ignored' ? 0 : 1,
          skipped: result === 'ignored' ? 1 : 0,
          total: 1,
        });
      }

      if (!batch.hasMore || !batch.nextCursor) {
        return aggregate;
      }

      cursor = batch.nextCursor;
    }
  }
}

let taskReconciliationServiceInstance: TaskReconciliationService | null = null;

export function getTaskReconciliationService(): TaskReconciliationService {
  if (!taskReconciliationServiceInstance) {
    taskReconciliationServiceInstance = new TaskReconciliationService();
  }
  return taskReconciliationServiceInstance;
}

export function resetTaskReconciliationServiceForTests(): void {
  taskReconciliationServiceInstance = null;
}
