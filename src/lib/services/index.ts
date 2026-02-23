/**
 * Services - 统一导出
 */

export { EventLogServiceImpl, getEventLogService } from './eventlog.service';
export type { EventLogService } from './eventlog.service';

export { TimeBlockServiceImpl, getTimeBlockService } from './timeblock.service';
export type { TimeBlockService } from './timeblock.service';

export { TaskServiceImpl, getTaskService } from './task.service';
export type { TaskService } from './task.service';

// 重新导出类型（这些类型在 types/event 中定义）
export type { TimerMode, TimerConfig } from '../types/event';
