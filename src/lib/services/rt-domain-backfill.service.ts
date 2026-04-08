import { parseRuntimeAddress, type RuntimeTarget } from '@/config/runtime-target';
import {
  EventLogBackupServiceImpl,
  type EventLogImportResult,
} from '@/lib/services/eventlog-backup.service';
import {
  TaskBackupServiceImpl,
  type TaskImportResult,
} from '@/lib/services/task-backup.service';
import {
  TimeBlockBackupServiceImpl,
  type TimeBlockImportResult,
} from '@/lib/services/timeblock-backup.service';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { notifyTaskDataChanged } from '@/lib/services/task.service';
import { notifyTimeBlockDataChanged } from '@/lib/services/timeblock.service';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import {
  hasRuntimeControlAuth,
  resolveRuntimeHostDialAddress,
} from '@/lib/utils/runtime-host-address';
import { log } from '@/lib/logger';

type EventLogBackupLike = Pick<EventLogBackupServiceImpl, 'exportEventsAsSqliteSnapshot'>;
type LocalEventLogBackupLike = Pick<EventLogBackupServiceImpl, 'importEventsFromSqliteSnapshot'>;
type TaskBackupLike = Pick<TaskBackupServiceImpl, 'exportTasksAsSqliteSnapshot'>;
type LocalTaskBackupLike = Pick<TaskBackupServiceImpl, 'importTasksFromSqliteSnapshot'>;
type TimeBlockBackupLike = Pick<TimeBlockBackupServiceImpl, 'exportTimeBlocksAsSqliteSnapshot'>;
type LocalTimeBlockBackupLike = Pick<TimeBlockBackupServiceImpl, 'importTimeBlocksFromSqliteSnapshot'>;

export interface RtDomainBackfillServiceOptions {
  hostService?: Pick<ReturnType<typeof getRuntimeHostService>, 'listHosts'>;
  localEventLogBackupService?: LocalEventLogBackupLike;
  localTaskBackupService?: LocalTaskBackupLike;
  localTimeBlockBackupService?: LocalTimeBlockBackupLike;
  createPeerEventLogBackupService?: (target: RuntimeTarget) => EventLogBackupLike;
  createPeerTaskBackupService?: (target: RuntimeTarget) => TaskBackupLike;
  createPeerTimeBlockBackupService?: (target: RuntimeTarget) => TimeBlockBackupLike;
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

export class RtDomainBackfillService {
  private readonly hostService: Pick<ReturnType<typeof getRuntimeHostService>, 'listHosts'>;
  private readonly localEventLogBackupService: LocalEventLogBackupLike;
  private readonly localTaskBackupService: LocalTaskBackupLike;
  private readonly localTimeBlockBackupService: LocalTimeBlockBackupLike;
  private readonly createPeerEventLogBackupService: (target: RuntimeTarget) => EventLogBackupLike;
  private readonly createPeerTaskBackupService: (target: RuntimeTarget) => TaskBackupLike;
  private readonly createPeerTimeBlockBackupService: (target: RuntimeTarget) => TimeBlockBackupLike;

  constructor(options: RtDomainBackfillServiceOptions = {}) {
    this.hostService = options.hostService ?? getRuntimeHostService();
    this.localEventLogBackupService = options.localEventLogBackupService ?? new EventLogBackupServiceImpl();
    this.localTaskBackupService = options.localTaskBackupService ?? new TaskBackupServiceImpl();
    this.localTimeBlockBackupService = options.localTimeBlockBackupService ?? new TimeBlockBackupServiceImpl();
    this.createPeerEventLogBackupService = options.createPeerEventLogBackupService
      ?? ((target) => new EventLogBackupServiceImpl({ resolveTarget: () => target }));
    this.createPeerTaskBackupService = options.createPeerTaskBackupService
      ?? ((target) => new TaskBackupServiceImpl({ resolveTarget: () => target }));
    this.createPeerTimeBlockBackupService = options.createPeerTimeBlockBackupService
      ?? ((target) => new TimeBlockBackupServiceImpl({ resolveTarget: () => target }));
  }

  async backfillConfirmedPeers(): Promise<RtDomainBackfillSummary> {
    const hosts = await this.hostService.listHosts();
    const confirmedPeers = hosts.filter((host) => (
      host.trustState === 'confirmed_peer'
      && host.hostId
      && hasRuntimeControlAuth(host)
    ));
    const summary = createEmptySummary();

    for (const peer of confirmedPeers) {
      const target = buildPeerRuntimeTarget(peer);
      const peerEventLogBackupService = this.createPeerEventLogBackupService(target);
      const peerTaskBackupService = this.createPeerTaskBackupService(target);
      const peerTimeBlockBackupService = this.createPeerTimeBlockBackupService(target);

      const [eventlogSnapshotResult, taskSnapshotResult, timeblockSnapshotResult] = await Promise.allSettled([
        peerEventLogBackupService.exportEventsAsSqliteSnapshot(),
        peerTaskBackupService.exportTasksAsSqliteSnapshot(),
        peerTimeBlockBackupService.exportTimeBlocksAsSqliteSnapshot(),
      ]);

      let eventlogImport: EventLogImportResult = { imported: 0, skipped: 0, total: 0 };
      let taskImport: TaskImportResult = { imported: 0, skipped: 0, total: 0 };
      let timeblockImport: TimeBlockImportResult = { imported: 0, skipped: 0, total: 0, activeBlockUpdated: false };

      if (eventlogSnapshotResult.status === 'fulfilled') {
        eventlogImport = await this.localEventLogBackupService.importEventsFromSqliteSnapshot(eventlogSnapshotResult.value.bytes, 'merge');
      } else {
        log.warn(`[RtDomainBackfill] peer eventlog export failed: ${peer.id} ${eventlogSnapshotResult.reason instanceof Error ? eventlogSnapshotResult.reason.message : String(eventlogSnapshotResult.reason)}`);
      }

      if (taskSnapshotResult.status === 'fulfilled') {
        taskImport = await this.localTaskBackupService.importTasksFromSqliteSnapshot(taskSnapshotResult.value.bytes, 'merge');
        notifyTaskDataChanged();
      } else {
        log.warn(`[RtDomainBackfill] peer task export failed: ${peer.id} ${taskSnapshotResult.reason instanceof Error ? taskSnapshotResult.reason.message : String(taskSnapshotResult.reason)}`);
      }

      if (timeblockSnapshotResult.status === 'fulfilled') {
        timeblockImport = await this.localTimeBlockBackupService.importTimeBlocksFromSqliteSnapshot(timeblockSnapshotResult.value.bytes, 'merge');
        notifyTimeBlockDataChanged();
      } else {
        log.warn(`[RtDomainBackfill] peer timeblock export failed: ${peer.id} ${timeblockSnapshotResult.reason instanceof Error ? timeblockSnapshotResult.reason.message : String(timeblockSnapshotResult.reason)}`);
      }

      summary.peers += 1;
      summary.eventlog.imported += eventlogImport.imported;
      summary.eventlog.skipped += eventlogImport.skipped;
      summary.eventlog.total += eventlogImport.total;
      summary.tasks.imported += taskImport.imported;
      summary.tasks.skipped += taskImport.skipped;
      summary.tasks.total += taskImport.total;
      summary.timeblocks.imported += timeblockImport.imported;
      summary.timeblocks.skipped += timeblockImport.skipped;
      summary.timeblocks.total += timeblockImport.total;
      summary.timeblocks.activeBlockUpdated = summary.timeblocks.activeBlockUpdated || timeblockImport.activeBlockUpdated;
    }

    return summary;
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
