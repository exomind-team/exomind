/**
 * TimeBlockService - 时间块管理
 *
 * ┌─────────────────────────────────────────┐
 * │  L3 Service                            │
 * │  ─────────────────────────────────     │
 * │  - 时间块 CRUD                         │
 * │  - 计时状态管理                         │
 * │  - 事件关联                           │
 * └─────────────────────────────────────────┘
 */

import { ExoMindEnvironment } from '../environment/environment';
import { getEventStorage } from '../storage/event-storage';
import type { TimeBlock, TimeBlockData, ActiveBlockData, TimerConfig } from '../types/event';

// 存储键
const TIME_BLOCKS_KEY = 'time_blocks';
const ACTIVE_BLOCK_KEY = 'active_block';

export interface TimeBlockService {
  /** 加载已完成的时间块 */
  loadTimeBlocks(): Promise<TimeBlock[]>;

  /** 加载当前进行中的时间块 */
  loadActiveBlock(): Promise<ActiveBlockData | null>;

  /** 开始时间块 */
  startBlock(name: string, config: TimerConfig): Promise<ActiveBlockData>;

  /** 暂停时间块 */
  pauseBlock(): Promise<void>;

  /** 继续时间块 */
  resumeBlock(): Promise<void>;

  /** 结束时间块 */
  endBlock(feedback?: string): Promise<TimeBlock | null>;

  /** 更新已计时时长（由 UI 定时调用） */
  updateElapsed(elapsed: number): Promise<void>;

  /** 监听时间块变化 */
  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void;
}

export class TimeBlockServiceImpl implements TimeBlockService {
  private env: ExoMindEnvironment;
  private listeners: Set<(block: ActiveBlockData | null) => void> = new Set();
  private lastWriteTime = 0;
  private readonly WRITE_THROTTLE_MS = 1000; // 节流：每秒最多写入一次

  constructor(env?: ExoMindEnvironment) {
    this.env = env || ExoMindEnvironment.getInstance();
  }

  async loadTimeBlocks(): Promise<TimeBlock[]> {
    const data = await this.env.storage.read<TimeBlockData[]>(TIME_BLOCKS_KEY);
    if (!data) return [];

    return data.map(d => ({
      ...d,
      tags: new Set(d.tags),
    }));
  }

  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data) return null;

    const normalized = this.normalizeActiveBlock(data);
    if (this.shouldPersistNormalized(data, normalized)) {
      await this.env.storage.write(ACTIVE_BLOCK_KEY, normalized);
    }

    return normalized;
  }

  async startBlock(name: string, config: TimerConfig): Promise<ActiveBlockData> {
    // 不允许在已有活跃块（运行中/已暂停）时开启新块
    const existing = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (existing) {
      const normalized = this.normalizeActiveBlock(existing);
      if (this.shouldPersistNormalized(existing, normalized)) {
        await this.env.storage.write(ACTIVE_BLOCK_KEY, normalized);
      }
      return normalized;
    }

    const startId = crypto.randomUUID();
    const now = Date.now();
    const initialElapsed = config.mode === 'countdown'
      ? (config.minutes ?? 25) * 60 * 1000
      : 0;

    // 创建开始事件
    await this.addBlockEvent(name, 'block_start');

    // 保存进行中的时间块
    const activeBlock: ActiveBlockData = {
      startId,
      name,
      startTime: now,
      elapsed: initialElapsed,
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? (config.minutes ?? 25) : undefined,
      updatedAt: now,
      paused: false,
    };

    await this.env.storage.write(ACTIVE_BLOCK_KEY, activeBlock);

    // 通知变化
    this.notifyChange(activeBlock);

    return activeBlock;
  }

  async pauseBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data || data.paused) return;

    const now = Date.now();
    const normalized = this.normalizeActiveBlock(data, now);
    const pausedBlock: ActiveBlockData = {
      ...normalized,
      paused: true,
      pausedAt: now,
      updatedAt: now,
    };

    await this.env.storage.write(ACTIVE_BLOCK_KEY, pausedBlock);

    // 记录暂停事件
    await this.addBlockEvent(`${normalized.name} 暂停`, 'block_pause');
    this.notifyChange(pausedBlock);
  }

  async resumeBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data || !data.paused) return;

    const now = Date.now();
    const resumedBlock: ActiveBlockData = {
      ...data,
      paused: false,
      pausedAt: undefined,
      updatedAt: now,
    };

    await this.env.storage.write(ACTIVE_BLOCK_KEY, resumedBlock);

    // 记录继续事件
    await this.addBlockEvent(`${data.name} 继续`, 'block_resume');
    this.notifyChange(resumedBlock);
  }

  async endBlock(feedback?: string): Promise<TimeBlock | null> {
    const rawActiveData = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!rawActiveData) return null;
    const activeData = this.normalizeActiveBlock(rawActiveData);

    const endId = crypto.randomUUID();

    // 创建结束事件（通过 EventStorage，与 ChatPage 保持一致）
    await this.addBlockEvent(`${activeData.name} 完成`, 'block_end');

    // 身心反馈作为独立事件添加到事件日志（通过 EventStorage）
    if (feedback) {
      const storage = getEventStorage();
      await storage.addEvent({
        id: crypto.randomUUID(),
        content: feedback,
        createdAt: new Date().toISOString(),
        type: 'block_feedback',
      });
    }

    // 保存已完成的时间块
    const timeBlock: TimeBlockData = {
      id: activeData.startId,  // 使用 startId 作为 id
      name: activeData.name,
      startId: activeData.startId,
      endId,
      note: feedback,
      tags: feedback ? ['block_feedback'] : [],
      startTime: activeData.startTime,
      endTime: Date.now(),
    };

    // 追加到已完成列表
    const completed = await this.env.storage.read<TimeBlockData[]>(TIME_BLOCKS_KEY) || [];
    completed.push(timeBlock);
    await this.env.storage.write(TIME_BLOCKS_KEY, completed);

    // 清除进行中的时间块
    await this.env.storage.delete(ACTIVE_BLOCK_KEY);

    // 通知变化
    this.notifyChange(null);

    return {
      ...timeBlock,
      tags: new Set(timeBlock.tags),
    };
  }

  async updateElapsed(elapsed: number): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data || data.paused) return;

    const now = Date.now();
    // 节流：每秒最多写入一次
    if (now - this.lastWriteTime < this.WRITE_THROTTLE_MS) {
      return;
    }
    this.lastWriteTime = now;

    await this.env.storage.write(ACTIVE_BLOCK_KEY, {
      ...data,
      elapsed,
      updatedAt: now,
    });
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 添加时间块事件（通过 EventStorage，与 ChatPage 保持一致） */
  private async addBlockEvent(
    content: string,
    tag: 'block_start' | 'block_end' | 'block_pause' | 'block_resume',
  ): Promise<void> {
    // 使用 EventStorage 保存事件，与 ChatPage 保持一致
    const storage = getEventStorage();
    await storage.addEvent({
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
      type: tag,
    });
  }

  private notifyChange(block: ActiveBlockData | null): void {
    this.listeners.forEach(cb => cb(block));
  }

  private normalizeActiveBlock(data: ActiveBlockData, now: number = Date.now()): ActiveBlockData {
    // 兼容旧数据：无 updatedAt 时先以当前时间建立基准，避免一次性错误跳变
    const baseTime = data.updatedAt ?? now;
    if (data.paused) {
      return {
        ...data,
        updatedAt: baseTime,
      };
    }

    const delta = Math.max(0, now - baseTime);
    const nextElapsed = data.mode === 'countdown'
      ? Math.max(0, data.elapsed - delta)
      : data.elapsed + delta;

    return {
      ...data,
      elapsed: nextElapsed,
      updatedAt: now,
    };
  }

  private shouldPersistNormalized(prev: ActiveBlockData, next: ActiveBlockData): boolean {
    return prev.elapsed !== next.elapsed || prev.updatedAt !== next.updatedAt;
  }
}

// 单例导出
let timeBlockServiceInstance: TimeBlockService | null = null;

export function getTimeBlockService(): TimeBlockService {
  if (!timeBlockServiceInstance) {
    timeBlockServiceInstance = new TimeBlockServiceImpl();
  }
  return timeBlockServiceInstance;
}
