/**
 * Services - 统一导出
 */

export { EventLogServiceImpl, getEventLogService } from './eventlog.service';
export type { EventLogService } from './eventlog.service';
export {
  EventLogBackupServiceImpl,
  getEventLogBackupService,
  resetEventLogBackupServiceForTests,
} from './eventlog-backup.service';
export type {
  EventLogBackendStatus,
  EventLogExportJsonResult,
  EventLogExportSqliteResult,
  EventLogImportResult,
  EventLogImportStrategy,
} from './eventlog-backup.service';

export { TimeBlockServiceImpl, getTimeBlockService } from './timeblock.service';
export type { TimeBlockService } from './timeblock.service';
export {
  TimeBlockBackupServiceImpl,
  getTimeBlockBackupService,
  resetTimeBlockBackupServiceForTests,
} from './timeblock-backup.service';
export type {
  TimeBlockBackendStatus,
  TimeBlockExportJsonResult,
  TimeBlockExportSqliteResult,
  TimeBlockImportResult,
  TimeBlockImportStrategy,
} from './timeblock-backup.service';

export { TaskServiceImpl, getTaskService } from './task.service';
export type { TaskService } from './task.service';
export {
  TaskBackupServiceImpl,
  getTaskBackupService,
  resetTaskBackupServiceForTests,
} from './task-backup.service';
export type {
  TaskBackendStatus,
  TaskExportJsonResult,
  TaskExportSqliteResult,
  TaskImportResult,
  TaskImportStrategy,
} from './task-backup.service';

export { TaskTimerServiceImpl, getTaskTimerService } from './task-timer.service';
export type { TaskTimerService } from './task-timer.service';

export { ReminderServiceImpl, getReminderService } from './reminder.service';
export type { ReminderService } from './reminder.service';
export {
  ReminderSchedulerServiceImpl,
  getReminderSchedulerService,
} from './reminder-scheduler.service';
export type { ReminderSchedulerService } from './reminder-scheduler.service';

export { MeServiceImpl, getMeService } from './me.service';
export type { MeService } from './me.service';
export { AgentHubServiceImpl, getAgentHubService } from './agent-hub.service';
export type { AgentHubService } from './agent-hub.service';
export { ClipboardServiceImpl, getClipboardService } from './clipboard.service';
export type { ClipboardService, ClipboardReadResult, ClipboardFailureReason } from './clipboard.service';
export { CommandRegistryServiceImpl, getCommandRegistryService } from './command-registry.service';
export type { CommandRegistryService } from './command-registry.service';
export { CommandPaletteServiceImpl, getCommandPaletteService } from './command-palette.service';
export type { CommandPaletteService, CommandPaletteState } from './command-palette.service';
export { RuntimeAggregatorServiceImpl, getRuntimeAggregatorService } from './runtime-aggregator.service';
export type { RuntimeAggregatorService, RuntimeAgentInfo, AggregatedRuntimeData } from './runtime-aggregator.service';
export {
  RuntimeMeshHostSyncService,
  getRuntimeMeshHostSyncService,
  resetRuntimeMeshHostSyncServiceForTests,
} from './runtime-mesh-host-sync.service';
export type { RuntimeMeshHostSyncServiceOptions } from './runtime-mesh-host-sync.service';

export { SignalStreamService, getSignalStreamService } from './signal-stream.service';
export type { SignalStreamServiceOptions, SignalCallback } from './signal-stream.service';
export { RuntimeLinkProofService, createRuntimeLinkProofService } from './runtime-link-proof.service';
export type {
  RuntimeLinkProofServiceOptions,
  RuntimeLinkProofRunOptions,
  RuntimeLinkProofResult,
  RuntimeLinkProofVerifiedResult,
  RuntimeLinkProofFailedResult,
} from './runtime-link-proof.service';
export { HttpSseSignalTransport, buildSignalBaseUrl, buildSignalStreamUrl } from './signal-http-sse-transport';
export type { SignalTransport, SignalStreamOpenRequest } from './signal-http-sse-transport';
export { SignalRouteService, getSignalRouteService } from './signal-route.service';
export type { SignalRouteServiceOptions } from './signal-route.service';

// 重新导出类型（这些类型在 types/event 中定义）
export type { TimerMode, TimerConfig } from '../types/event';
