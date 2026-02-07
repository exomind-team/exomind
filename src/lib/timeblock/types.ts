/**
 * TimeBlock 模块 - 类型定义
 *
 * @module timeblock/types
 */

/**
 * 时间块状态
 */
export enum TimeBlockStatus {
  Pending = 'pending',       // 待执行
  InProgress = 'in_progress', // 执行中
  Completed = 'completed',    // 已完成
  Cancelled = 'cancelled',    // 已取消
}

/**
 * 时间块类型
 */
export enum TimeBlockType {
  Work = 'work',           // 工作
  Rest = 'rest',           // 休息
  Meeting = 'meeting',      // 会议
  Exercise = 'exercise',    // 锻炼
  Learning = 'learning',    // 学习
  Custom = 'custom',       // 自定义
}

/**
 * 时间块标签
 */
export interface TimeBlockLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * 时间块
 */
export interface TimeBlock {
  /** 唯一标识 */
  id: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 开始时间 (ISO 8601) */
  startTime: string;
  /** 结束时间 (ISO 8601) */
  endTime: string;
  /** 状态 */
  status: TimeBlockStatus;
  /** 类型 */
  type: TimeBlockType;
  /** 标签 ID 列表 */
  labelIds?: string[];
  /** 备注 */
  notes?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 创建时间块参数
 */
export interface CreateTimeBlockParams {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  type?: TimeBlockType;
  labelIds?: string[];
  notes?: string;
}

/**
 * 更新时间块参数
 */
export interface UpdateTimeBlockParams {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  status?: TimeBlockStatus;
  type?: TimeBlockType;
  labelIds?: string[];
  notes?: string;
}

/**
 * 时间块查询条件
 */
export interface TimeBlockQuery {
  /** 按状态筛选 */
  status?: TimeBlockStatus | TimeBlockStatus[];
  /** 按类型筛选 */
  type?: TimeBlockType | TimeBlockType[];
  /** 开始时间范围 */
  startTimeFrom?: string;
  startTimeTo?: string;
  /** 结束时间范围 */
  endTimeFrom?: string;
  endTimeTo?: string;
  /** 按标签筛选 */
  labelIds?: string[];
}

/**
 * 时间统计
 */
export interface TimeBlockStats {
  /** 总时间块数 */
  totalCount: number;
  /** 已完成数 */
  completedCount: number;
  /** 总时长（分钟） */
  totalDuration: number;
  /** 已完成时长（分钟） */
  completedDuration: number;
  /** 按类型统计 */
  byType: Record<TimeBlockType, { count: number; duration: number }>;
  /** 按状态统计 */
  byStatus: Record<TimeBlockStatus, { count: number; duration: number }>;
}

/**
 * 一天的时间块摘要
 */
export interface DaySummary {
  date: string;
  totalBlocks: number;
  completedBlocks: number;
  totalWorkMinutes: number;
  totalRestMinutes: number;
  firstBlock?: TimeBlock;
  lastBlock?: TimeBlock;
}

/**
 * TimeBlock 存储配置
 */
export interface TimeBlockStorageConfig {
  /** 数据目录路径 */
  dataPath: string;
  /** 文件名 */
  filename: string;
  /** 是否启用压缩 */
  compress?: boolean;
  /** 最大保留天数 (0 = 不限制) */
  maxRetentionDays?: number;
}

/**
 * 默认存储配置
 */
export const DEFAULT_TIMEBLOCK_STORAGE_CONFIG: TimeBlockStorageConfig = {
  dataPath: './data/timeblocks',
  filename: 'timeblocks.jsonl',
  compress: false,
  maxRetentionDays: 0,
};
