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
import type { Event, TimeBlock, TimeBlockData, ActiveBlockData, TimerConfig } from '../types/event';

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
    return data || null;
  }

  async startBlock(name: string, config: TimerConfig): Promise<ActiveBlockData> {
    const startId = crypto.randomUUID();

    // 创建开始事件
    await this.addBlockEvent(startId, name, 'block_start');

    // 保存进行中的时间块
    const activeBlock: ActiveBlockData = {
      startId,
      name,
      startTime: Date.now(),
      elapsed: 0,
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? config.minutes : undefined,
      paused: false,
    };

    await this.env.storage.write(ACTIVE_BLOCK_KEY, activeBlock);

    // 通知变化
    this.notifyChange(activeBlock);

    return activeBlock;
  }

  async pauseBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data) return;

    await this.env.storage.write(ACTIVE_BLOCK_KEY, {
      ...data,
      paused: true,
      pausedAt: Date.now(),
    });

    const block = await this.loadActiveBlock();
    if (block) this.notifyChange(block);
  }

  async resumeBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!data || !data.paused) return;

    await this.env.storage.write(ACTIVE_BLOCK_KEY, {
      ...data,
      paused: false,
      pausedAt: undefined,
    });

    const block = await this.loadActiveBlock();
    if (block) this.notifyChange(block);
  }

  async endBlock(feedback?: string): Promise<TimeBlock | null> {
    const activeData = await this.env.storage.read<ActiveBlockData>(ACTIVE_BLOCK_KEY);
    if (!activeData) return null;

    const endId = crypto.randomUUID();

    // 创建结束事件（带身心反馈）
    const eventContent = feedback || `${activeData.name} 完成`;
    await this.addBlockEvent(endId, eventContent, 'block_end', feedback);

    // 保存已完成的时间块
    const timeBlock: TimeBlockData = {
      id: activeData.startId,  // 使用 startId 作为 id
      name: activeData.name,
      startId: activeData.startId,
      endId,
      note: feedback,
      tags: ['block_feedback'],
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

    await this.env.storage.write(ACTIVE_BLOCK_KEY, {
      ...data,
      elapsed,
    });
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 添加时间块事件 */
  private async addBlockEvent(
    eventId: string,
    content: string,
    tag: 'block_start' | 'block_end',
    _feedback?: string
  ): Promise<Event> {
    const tags: string[] = [tag];
    if (tag === 'block_end') {
      tags.push('block_feedback');
    }

    const eventData = {
      id: eventId,
      timestamp: Date.now(),
      content,
      tags,
    };

    // 读取现有事件
    const eventsKey = 'events';
    const events = await this.env.storage.read<any[]>(eventsKey) || [];
    events.unshift(eventData);
    await this.env.storage.write(eventsKey, events);

    return {
      id: eventId,
      timestamp: eventData.timestamp,
      content: eventData.content,
      tags: new Set(eventData.tags),
    };
  }

  private notifyChange(block: ActiveBlockData | null): void {
    this.listeners.forEach(cb => cb(block));
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
