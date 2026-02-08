/**
 * TimeBlock 模块 - 统一导出
 *
 * 基于 MVP-ARCHITECTURE.md 文档
 * @module timeblock
 */

// 类型定义
export * from './types';

// 持久化存储
export { TimeBlockStorage } from './persistence';

// Store
export { useTimeBlockStore } from './store';

// 便捷函数
export {
  initTimeBlockStore,
  hasActiveBlock,
  getActiveBlock,
  parseTimeBlockCommand,
} from './store';
