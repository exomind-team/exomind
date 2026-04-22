import {
  TaskRtAdapter,
  runtimeTaskPayloadToTaskNode,
} from '@/lib/adapters/task-rt-adapter';
import { log } from '@/lib/logger';
import { PerfTrace } from '@/lib/utils/perf-trace';
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

function hasSameWatermark(summary: TaskReplicationSummary, other: TaskReplicationSummary): boolean {
  return summary.maxUpdatedAt === other.maxUpdatedAt;
}

function isRemoteClearlyNotNewer(
  localSummary: TaskReplicationSummary,
  remoteSummary: TaskReplicationSummary,
): boolean {
  return remoteSummary.maxUpdatedAt < localSummary.maxUpdatedAt
    || (
      hasSameWatermark(localSummary, remoteSummary)
      && remoteSummary.taskCount <= localSummary.taskCount
    );
}

function shouldSkipPullAndGoToSnapshot(
  localSummary: TaskReplicationSummary,
  remoteSummary: TaskReplicationSummary,
): boolean {
  return hasSameWatermark(localSummary, remoteSummary)
    && remoteSummary.taskCount > localSummary.taskCount;
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
    const trace = new PerfTrace('TaskReconciliation reconcilePeer', { peerId });
    try {
      const localSummary = await this.taskBackupService.getTaskReplicationSummary();
      trace.step('get-local-summary', {
        taskCount: localSummary.taskCount,
        maxUpdatedAt: localSummary.maxUpdatedAt,
      });
      const remoteSummary = await this.taskBackupService.getPeerTaskReplicationSummary(peerId);
      trace.step('get-remote-summary', {
        taskCount: remoteSummary.taskCount,
        maxUpdatedAt: remoteSummary.maxUpdatedAt,
      });

      if (hasScopeMismatch(localSummary, remoteSummary)) {
        log.warn(
          `[TaskReconciliation] scope mismatch, skip auto-repair: peer=${peerId} local=${formatSummary(localSummary)} remote=${formatSummary(remoteSummary)}`,
        );
        const result = {
          ...createEmptyImportResult(),
          peerId,
          changed: false,
          unresolvedDrift: true,
          strategy: 'unresolved' as const,
          localSummary,
          remoteSummary,
        };
        trace.finish({ strategy: result.strategy, unresolvedDrift: true });
        return result;
      }

      if (areSummariesEqual(localSummary, remoteSummary)) {
        const result = {
          ...createEmptyImportResult(),
          peerId,
          changed: false,
          unresolvedDrift: false,
          strategy: 'noop' as const,
          localSummary,
          remoteSummary,
        };
        trace.finish({ strategy: result.strategy, unresolvedDrift: false });
        return result;
      }

      if (isRemoteClearlyNotNewer(localSummary, remoteSummary)) {
        log.warn(
          `[TaskReconciliation] drift detected but remote is not newer or more complete; keep local state: peer=${peerId} local=${formatSummary(localSummary)} remote=${formatSummary(remoteSummary)}`,
        );
        const result = {
          ...createEmptyImportResult(),
          peerId,
          changed: false,
          unresolvedDrift: true,
          strategy: 'unresolved' as const,
          localSummary,
          remoteSummary,
        };
        trace.finish({ strategy: result.strategy, unresolvedDrift: true });
        return result;
      }

      let pullImport = createEmptyImportResult();
      if (shouldSkipPullAndGoToSnapshot(localSummary, remoteSummary)) {
        log.warn(
          `[TaskReconciliation] remote drift shares local watermark; skip pull and try snapshot: peer=${peerId} local=${formatSummary(localSummary)} remote=${formatSummary(remoteSummary)}`,
        );
        trace.step('skip-pull-and-go-to-snapshot');
      } else {
        try {
          pullImport = await this.pullPeerTasks(peerId);
          trace.step('pull-peer-tasks', {
            imported: pullImport.imported,
            skipped: pullImport.skipped,
            total: pullImport.total,
          });
        } catch (error) {
          trace.step('pull-peer-tasks-failed');
          log.warn(
            `[TaskReconciliation] peer pull failed, fallback to snapshot: peer=${peerId} ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      let currentLocalSummary = await this.taskBackupService.getTaskReplicationSummary();
      trace.step('get-local-summary-after-pull', {
        taskCount: currentLocalSummary.taskCount,
        maxUpdatedAt: currentLocalSummary.maxUpdatedAt,
      });
      if (areSummariesEqual(currentLocalSummary, remoteSummary)) {
        const result = {
          ...pullImport,
          peerId,
          changed: pullImport.imported > 0,
          unresolvedDrift: false,
          strategy: 'pull' as const,
          localSummary: currentLocalSummary,
          remoteSummary,
        };
        trace.finish({
          strategy: result.strategy,
          unresolvedDrift: false,
          imported: result.imported,
          skipped: result.skipped,
          total: result.total,
        });
        return result;
      }

      const beforeSnapshotSummary = currentLocalSummary;
      const snapshot = await this.taskBackupService.exportPeerTasksAsSqliteSnapshot(peerId);
      trace.step('export-snapshot', { taskCount: snapshot.taskCount });
      const snapshotImport = await this.taskBackupService.importTasksFromSqliteSnapshot(
        snapshot.bytes,
        'merge',
      );
      trace.step('import-snapshot', {
        imported: snapshotImport.imported,
        skipped: snapshotImport.skipped,
        total: snapshotImport.total,
      });
      currentLocalSummary = await this.taskBackupService.getTaskReplicationSummary();
      trace.step('get-local-summary-after-snapshot', {
        taskCount: currentLocalSummary.taskCount,
        maxUpdatedAt: currentLocalSummary.maxUpdatedAt,
      });
      const combinedImport = mergeImportResults(pullImport, snapshotImport);
      const snapshotChanged = !areSummariesEqual(beforeSnapshotSummary, currentLocalSummary);

      if (areSummariesEqual(currentLocalSummary, remoteSummary)) {
        const result = {
          ...combinedImport,
          peerId,
          changed: pullImport.imported > 0 || snapshotChanged,
          unresolvedDrift: false,
          strategy: 'pull_then_snapshot' as const,
          localSummary: currentLocalSummary,
          remoteSummary,
        };
        trace.finish({
          strategy: result.strategy,
          unresolvedDrift: false,
          imported: result.imported,
          skipped: result.skipped,
          total: result.total,
        });
        return result;
      }

      log.warn(
        `[TaskReconciliation] unresolved drift after snapshot fallback: peer=${peerId} local=${formatSummary(currentLocalSummary)} remote=${formatSummary(remoteSummary)}`,
      );
      const result = {
        ...combinedImport,
        peerId,
        changed: pullImport.imported > 0 || snapshotChanged,
        unresolvedDrift: true,
        strategy: 'unresolved' as const,
        localSummary: currentLocalSummary,
        remoteSummary,
      };
      trace.finish({
        strategy: result.strategy,
        unresolvedDrift: true,
        imported: result.imported,
        skipped: result.skipped,
        total: result.total,
      });
      return result;
    } catch (error) {
      trace.fail(error);
      throw error;
    }
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
        let result: 'inserted' | 'updated' | 'ignored';
        try {
          result = await this.taskRtAdapter.applyReplicationSnapshot(
            runtimeTaskPayloadToTaskNode(runtimeTask),
            peerId,
          );
        } catch (error) {
          const statusHistoryCount = runtimeTask.status_transitions?.length ?? 0;
          throw new Error(
            `task=${runtimeTask.id} updatedAt=${runtimeTask.updated_at} statusTransitions=${statusHistoryCount} ${error instanceof Error ? error.message : String(error)}`,
          );
        }
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
