/**
 * Legacy Data Detection（旧数据检测）
 *
 * 使用依赖注入的 reader 函数检测是否存在需要迁移的旧数据，
 * 以及 RT（Runtime）数据库是否为空（迁移目标是否干净）。
 *
 * 所有 reader 均为 async 函数，错误会被优雅捕获（返回 0，不抛出）。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegacyDataSummary {
  eventlogCount: number;
  taskCount: number;
  timeblockCount: number;
  hasActiveBlock: boolean;
  hasAnyData: boolean;
}

export interface LegacyDataReaders {
  readLegacyEvents: () => Promise<unknown[]>;
  readLegacyTasks: () => Promise<unknown[]>;
  readLegacyCompletedBlocks: () => Promise<unknown[]>;
  readLegacyActiveBlock: () => Promise<unknown | null>;
}

export interface RtDataReaders {
  readRtEvents: () => Promise<unknown[]>;
  readRtTasks: () => Promise<unknown[]>;
  readRtCompletedBlocks: () => Promise<unknown[]>;
  readRtActiveBlock: () => Promise<unknown | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely read an array; returns empty array on any error（安全读取数组，失败返回空数组）. */
async function safeReadArray(fn: () => Promise<unknown[]>): Promise<unknown[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

/** Safely read a nullable value; returns null on any error（安全读取可空值，失败返回 null）. */
async function safeReadNullable(fn: () => Promise<unknown | null>): Promise<unknown | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * detectLegacyData — 读取所有旧数据源并汇总统计。
 *
 * - 所有读取并发执行（Promise.all）。
 * - 单个 reader 失败不影响其他来源，失败项记为 0 / false。
 */
export async function detectLegacyData(readers: LegacyDataReaders): Promise<LegacyDataSummary> {
  const [events, tasks, completedBlocks, activeBlock] = await Promise.all([
    safeReadArray(readers.readLegacyEvents),
    safeReadArray(readers.readLegacyTasks),
    safeReadArray(readers.readLegacyCompletedBlocks),
    safeReadNullable(readers.readLegacyActiveBlock),
  ]);

  const eventlogCount = events.length;
  const taskCount = tasks.length;
  const timeblockCount = completedBlocks.length;
  const hasActiveBlock = activeBlock !== null;
  const hasAnyData = eventlogCount > 0 || taskCount > 0 || timeblockCount > 0 || hasActiveBlock;

  return { eventlogCount, taskCount, timeblockCount, hasActiveBlock, hasAnyData };
}

/**
 * RT reader 失败时视为"有数据"（返回 false），避免因 RT 不可达而误触发迁移。
 * 与 legacy reader 的保守策略相反：legacy 失败 = 无数据；RT 失败 = 有数据。
 */
async function rtHasNoArrayData(fn: () => Promise<unknown[]>): Promise<boolean> {
  try {
    return (await fn()).length === 0;
  } catch {
    return false; // RT 不可达时假设有数据，不触发迁移
  }
}

async function rtHasNoActiveBlock(fn: () => Promise<unknown | null>): Promise<boolean> {
  try {
    return (await fn()) === null;
  } catch {
    return false; // RT 不可达时假设有数据，不触发迁移
  }
}

/**
 * detectRtIsEmpty — 检测 RT 数据库是否完全为空。
 *
 * 当所有 RT 来源均无数据时返回 true（迁移目标干净，安全迁入）。
 * RT reader 失败视为"有数据"（返回 false），避免因 RT 不可达而误触发迁移。
 */
export async function detectRtIsEmpty(readers: RtDataReaders): Promise<boolean> {
  const [eventsEmpty, tasksEmpty, blocksEmpty, activeEmpty] = await Promise.all([
    rtHasNoArrayData(readers.readRtEvents),
    rtHasNoArrayData(readers.readRtTasks),
    rtHasNoArrayData(readers.readRtCompletedBlocks),
    rtHasNoActiveBlock(readers.readRtActiveBlock),
  ]);

  return eventsEmpty && tasksEmpty && blocksEmpty && activeEmpty;
}
