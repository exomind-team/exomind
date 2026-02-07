/**
 * TimeBlock 模块 - 统一导出
 *
 * @module timeblock
 */

// 类型定义
export * from './types';

// 持久化存储
export { TimeBlockStorage } from './persistence';

// Store
export { TimeBlockStore, getTimeBlockStore, destroyTimeBlockStore } from './store';

// 事件类型
export {
  TimeBlockEventType,
  type TimeBlockEventPayload,
  type TimeBlockEventListener,
} from './store';
