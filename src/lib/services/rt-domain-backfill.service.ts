import { parseRuntimeAddress, type RuntimeTarget } from '@/config/runtime-target';
import {
  EventLogBackupServiceImpl,
  type EventLogImportResult,
  type EventLogScopeGrantReconcileResult,
} from '@/lib/services/eventlog-backup.service';
import { type TaskImportResult } from '@/lib/services/task-backup.service';
import {
  TaskReconciliationService,
  getTaskReconciliationService,
} from '@/lib/services/task-reconciliation.service';
import {
  TimeBlockBackupServiceImpl,
  type TimeBlockImportResult,
  type TimeBlockScopeGrantReconcileResult,
} from '@/lib/services/timeblock-backup.service';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { notifyTaskDataChanged } from '@/lib/services/task.service';
import { notifyTimeBlockDataChanged } from '@/lib/services/timeblock.service';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  hasRuntimeControlAuth,
  resolveRuntimeHostDialAddress,
} from '@/lib/utils/runtime-host-address';
import { PerfTrace } from '@/lib/utils/perf-trace';
import { log } from '@/lib/logger';

type LegacyPeerEventLogBackupLike = Pick<EventLogBackupServiceImpl, 'exportEventsAsSqliteSnapshot'>;
type LocalEventLogBackupLike = Pick<
  EventLogBackupServiceImpl,
  'exportPeerEventsAsSqliteSnapshot' | 'importEventsFromSqliteSnapshot' | 'reconcileEventLogScopeGrants'
>;
type TaskReconciliationLike = Pick<TaskReconciliationService, 'reconcileScopeGrants' | 'reconcilePeer'>;
type LegacyPeerTimeBlockBackupLike = Pick<TimeBlockBackupServiceImpl, 'exportTimeBlocksAsSqliteSnapshot'>;
type LocalTimeBlockBackupLike = Pick<
  TimeBlockBackupServiceImpl,
  'exportPeerTimeBlocksAsSqliteSnapshot' | 'importTimeBlocksFromSqliteSnapshot' | 'reconcileTimeBlockScopeGrants'
>;

export interface RtDomainBackfillServiceOptions {
  hostService?: Pick<ReturnType<typeof getRuntimeHostService>, 'listHosts'>;
  localEventLogBackupService?: LocalEventLogBackupLike;
  taskReconciliationService?: TaskReconciliationLike;
  localTimeBlockBackupService?: LocalTimeBlockBackupLike;
  createPeerEventLogBackupService?: (target: RuntimeTarget) => LegacyPeerEventLogBackupLike;
  createPeerTimeBlockBackupService?: (target: RuntimeTarget) => LegacyPeerTimeBlockBackupLike;
}

export interface RtDomainBackfillSummary {
  peers: number;
  eventlog: EventLogImportResult;
  tasks: TaskImportResult;
  timeblocks: TimeBlockImportResult;
}

function buildPeerRuntimeTarget(host: RuntimeHostRecord): RuntimeTarget {
  const dialAddress = parseRuntimeAddress(resolveRuntimeHostDialAddress(host));
  return {
    mode: 'external',
    host: dialAddress.host,
    port: dialAddress.port,
    authToken: host.authToken,
  };
}

function createEmptySummary(): RtDomainBackfillSummary {
  return {
    peers: 0,
    eventlog: { imported: 0, skipped: 0, total: 0 },
    tasks: { imported: 0, skipped: 0, total: 0 },
    timeblocks: { imported: 0, skipped: 0, total: 0, activeBlockUpdated: false },
  };
}

function hostReconciliationKey(host: Pick<RuntimeHostRecord, 'id' | 'hostId'>): string {
  return host.hostId ?? `record:${host.id}`;
}

function dedupeHostsByReconciliationKey(hosts: RuntimeHostRecord[]): RuntimeHostRecord[] {
  const seen = new Set<string>();
  return hosts.filter((host) => {
    const key = hostReconciliationKey(host);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export class RtDomainBackfillService {
  private readonly hostService: Pick<ReturnType<typeof getRuntimeHostService>, 'listHosts'>;
  private readonly localEventLogBackupService: LocalEventLogBackupLike;
  private readonly taskReconciliationService: TaskReconciliationLike;
  private readonly localTimeBlockBackupService: LocalTimeBlockBackupLike;
  private readonly createPeerEventLogBackupService: (target: RuntimeTarget) => LegacyPeerEventLogBackupLike;
  private readonly createPeerTimeBlockBackupService: (target: RuntimeTarget) => LegacyPeerTimeBlockBackupLike;

  constructor(options: RtDomainBackfillServiceOptions = {}) {
    this.hostService = options.hostService ?? getRuntimeHostService();
    this.localEventLogBackupService = options.localEventLogBackupService ?? new EventLogBackupServiceImpl();
    this.taskReconciliationService = options.taskReconciliationService ?? getTaskReconciliationService();
    this.localTimeBlockBackupService = options.localTimeBlockBackupService ?? new TimeBlockBackupServiceImpl();
    this.createPeerEventLogBackupService = options.createPeerEventLogBackupService
      ?? ((target) => new EventLogBackupServiceImpl({ resolveTarget: () => target }));
    this.createPeerTimeBlockBackupService = options.createPeerTimeBlockBackupService
      ?? ((target) => new TimeBlockBackupServiceImpl({ resolveTarget: () => target }));
  }

  async backfillConfirmedPeers(): Promise<RtDomainBackfillSummary> {
    const trace = new PerfTrace('RtDomainBackfill backfillConfirmedPeers');
    const hosts = await this.hostService.listHosts();
    trace.step('list-hosts', { hostCount: hosts.length });
    const meshPeers = dedupeHostsByReconciliationKey(hosts.filter((host) => (
      host.trustState === 'confirmed_peer'
      && host.hostId
    )));
    const legacySnapshotPeers = dedupeHostsByReconciliationKey(hosts.filter((host) => (
      host.trustState === 'confirmed_peer'
      && !host.hostId
      && hasRuntimeControlAuth(host)
    )));
    const summary = createEmptySummary();
    const processedPeerIds = new Set<string>();
    let taskChanged = false;
    let timeblockChanged = false;

    if (meshPeers.length > 0) {
      try {
        await this.taskReconciliationService.reconcileScopeGrants();
        trace.step('reconcile-task-scope-grants', { granted: true });
      } catch (error) {
        log.warn(`[RtDomainBackfill] task scope grant reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
        trace.step('reconcile-task-scope-grants-failed');
      }

      await this.tryReconcileEventLogScopeGrants();
      trace.step('reconcile-eventlog-scope-grants');
      await this.tryReconcileTimeBlockScopeGrants();
      trace.step('reconcile-timeblock-scope-grants');
    }

    for (const peer of meshPeers) {
      const peerTrace = new PerfTrace('RtDomainBackfill meshPeer', {
        peerId: peer.hostId!,
      });
      processedPeerIds.add(hostReconciliationKey(peer));

      try {
        const taskResult = await this.taskReconciliationService.reconcilePeer(peer.hostId!);
        peerTrace.step('reconcile-tasks', {
          imported: taskResult.imported,
          skipped: taskResult.skipped,
          total: taskResult.total,
          strategy: taskResult.strategy,
          unresolvedDrift: taskResult.unresolvedDrift,
        });
        summary.tasks.imported += taskResult.imported;
        summary.tasks.skipped += taskResult.skipped;
        summary.tasks.total += taskResult.total;
        taskChanged = taskChanged || taskResult.changed;
      } catch (error) {
        log.warn(`[RtDomainBackfill] peer task reconcile failed: ${peer.hostId} ${error instanceof Error ? error.message : String(error)}`);
        peerTrace.step('reconcile-tasks-failed');
      }

      try {
        const eventlogSnapshot = await this.localEventLogBackupService.exportPeerEventsAsSqliteSnapshot(peer.hostId!);
        const eventlogImport = await this.localEventLogBackupService.importEventsFromSqliteSnapshot(eventlogSnapshot.bytes, 'merge');
        peerTrace.step('sync-eventlog', {
          imported: eventlogImport.imported,
          skipped: eventlogImport.skipped,
          total: eventlogImport.total,
        });
        summary.eventlog.imported += eventlogImport.imported;
        summary.eventlog.skipped += eventlogImport.skipped;
        summary.eventlog.total += eventlogImport.total;
      } catch (error) {
        log.warn(`[RtDomainBackfill] peer eventlog snapshot via mesh failed: ${peer.hostId} ${error instanceof Error ? error.message : String(error)}`);
        peerTrace.step('sync-eventlog-failed');
      }

      try {
        const timeblockSnapshot = await this.localTimeBlockBackupService.exportPeerTimeBlocksAsSqliteSnapshot(peer.hostId!);
        const timeblockImport = await this.localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot(timeblockSnapshot.bytes, 'merge');
        peerTrace.step('sync-timeblocks', {
          imported: timeblockImport.imported,
          skipped: timeblockImport.skipped,
          total: timeblockImport.total,
          activeBlockUpdated: timeblockImport.activeBlockUpdated,
        });
        summary.timeblocks.imported += timeblockImport.imported;
        summary.timeblocks.skipped += timeblockImport.skipped;
        summary.timeblocks.total += timeblockImport.total;
        summary.timeblocks.activeBlockUpdated = summary.timeblocks.activeBlockUpdated || timeblockImport.activeBlockUpdated;
        timeblockChanged = timeblockChanged || timeblockImport.imported > 0 || timeblockImport.activeBlockUpdated;
      } catch (error) {
        log.warn(`[RtDomainBackfill] peer timeblock snapshot via mesh failed: ${peer.hostId} ${error instanceof Error ? error.message : String(error)}`);
        peerTrace.step('sync-timeblocks-failed');
      }
      peerTrace.finish();
    }

    if (taskChanged) {
      notifyTaskDataChanged();
    }

    for (const peer of legacySnapshotPeers) {
      processedPeerIds.add(hostReconciliationKey(peer));
      const target = buildPeerRuntimeTarget(peer);
      const peerEventLogBackupService = this.createPeerEventLogBackupService(target);
      const peerTimeBlockBackupService = this.createPeerTimeBlockBackupService(target);

      const [eventlogSnapshotResult, timeblockSnapshotResult] = await Promise.allSettled([
        peerEventLogBackupService.exportEventsAsSqliteSnapshot(),
        peerTimeBlockBackupService.exportTimeBlocksAsSqliteSnapshot(),
      ]);

      let eventlogImport: EventLogImportResult = { imported: 0, skipped: 0, total: 0 };
      let timeblockImport: TimeBlockImportResult = { imported: 0, skipped: 0, total: 0, activeBlockUpdated: false };

      if (eventlogSnapshotResult.status === 'fulfilled') {
        eventlogImport = await this.localEventLogBackupService.importEventsFromSqliteSnapshot(eventlogSnapshotResult.value.bytes, 'merge');
      } else {
        log.warn(`[RtDomainBackfill] peer eventlog export failed: ${peer.id} ${eventlogSnapshotResult.reason instanceof Error ? eventlogSnapshotResult.reason.message : String(eventlogSnapshotResult.reason)}`);
      }

      if (timeblockSnapshotResult.status === 'fulfilled') {
        timeblockImport = await this.localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot(timeblockSnapshotResult.value.bytes, 'merge');
        timeblockChanged = timeblockChanged || timeblockImport.imported > 0 || timeblockImport.activeBlockUpdated;
      } else {
        log.warn(`[RtDomainBackfill] peer timeblock export failed: ${peer.id} ${timeblockSnapshotResult.reason instanceof Error ? timeblockSnapshotResult.reason.message : String(timeblockSnapshotResult.reason)}`);
      }

      summary.eventlog.imported += eventlogImport.imported;
      summary.eventlog.skipped += eventlogImport.skipped;
      summary.eventlog.total += eventlogImport.total;
      summary.timeblocks.imported += timeblockImport.imported;
      summary.timeblocks.skipped += timeblockImport.skipped;
      summary.timeblocks.total += timeblockImport.total;
      summary.timeblocks.activeBlockUpdated = summary.timeblocks.activeBlockUpdated || timeblockImport.activeBlockUpdated;
    }

    if (timeblockChanged) {
      notifyTimeBlockDataChanged();
    }

    summary.peers = processedPeerIds.size;
    trace.finish({
      peers: summary.peers,
      taskImported: summary.tasks.imported,
      eventlogImported: summary.eventlog.imported,
      timeblockImported: summary.timeblocks.imported,
      timeblockActiveUpdated: summary.timeblocks.activeBlockUpdated,
    });
    return summary;
  }

  private async tryReconcileEventLogScopeGrants(): Promise<EventLogScopeGrantReconcileResult | null> {
    try {
      return await this.localEventLogBackupService.reconcileEventLogScopeGrants();
    } catch (error) {
      log.warn(`[RtDomainBackfill] eventlog scope grant reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async tryReconcileTimeBlockScopeGrants(): Promise<TimeBlockScopeGrantReconcileResult | null> {
    try {
      return await this.localTimeBlockBackupService.reconcileTimeBlockScopeGrants();
    } catch (error) {
      log.warn(`[RtDomainBackfill] timeblock scope grant reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

let rtDomainBackfillServiceInstance: RtDomainBackfillService | null = null;

export function getRtDomainBackfillService(): RtDomainBackfillService {
  if (!rtDomainBackfillServiceInstance) {
    rtDomainBackfillServiceInstance = new RtDomainBackfillService();
  }
  return rtDomainBackfillServiceInstance;
}

export function resetRtDomainBackfillServiceForTests(): void {
  rtDomainBackfillServiceInstance = null;
}
