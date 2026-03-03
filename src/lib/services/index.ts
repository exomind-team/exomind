/**
 * Services - 统一导出
 */

export { EventLogServiceImpl, getEventLogService } from './eventlog.service';
export type { EventLogService } from './eventlog.service';

export { TimeBlockServiceImpl, getTimeBlockService } from './timeblock.service';
export type { TimeBlockService } from './timeblock.service';

export { TaskServiceImpl, getTaskService } from './task.service';
export type { TaskService } from './task.service';

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

export { SignalStreamService, getSignalStreamService } from './signal-stream.service';
export type { SignalStreamServiceOptions, SignalCallback } from './signal-stream.service';
export { SignalRouteService, getSignalRouteService } from './signal-route.service';
export type { SignalRouteServiceOptions } from './signal-route.service';

// 重新导出类型（这些类型在 types/event 中定义）
export type { TimerMode, TimerConfig } from '../types/event';
