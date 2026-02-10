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

import { ExoMindEnvironment, STORAGE_KEYS } from '../environment/environment.js';
import type {
  Event,
  EventData,
  TimeBlock,
  TimeBlockData,
  ActiveBlockData,
  TimerConfig,
  TimerMode,
  UUID,
} from '@exomind/shared';

// Re-export timer types
export type { TimerMode, TimerConfig } from '@exomind/shared';

export interface TimeBlockService {
  loadTimeBlocks(): Promise<TimeBlock[]>;
  loadActiveBlock(): Promise<ActiveBlockData | null>;
  startBlock(name: string, config: TimerConfig): Promise<ActiveBlockData>;
  pauseBlock(): Promise<void>;
  resumeBlock(): Promise<void>;
  endBlock(feedback?: string): Promise<TimeBlock | null>;
  updateElapsed(elapsed: number): Promise<void>;
  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void;
}

export class TimeBlockServiceImpl implements TimeBlockService {
  private env: ExoMindEnvironment;
  private listeners: Set<(block: ActiveBlockData | null) => void> = new Set();

  constructor(env: ExoMindEnvironment) {
    this.env = env;
  }

  async loadTimeBlocks(): Promise<TimeBlock[]> {
    const data = await this.env.storage.read<TimeBlockData[]>(STORAGE_KEYS.TIME_BLOCKS);
    if (!data) return [];

    return data.map(d => ({
      ...d,
      tags: new Set(d.tags),
    }));
  }

  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    const data = await this.env.storage.read<ActiveBlockData>(STORAGE_KEYS.ACTIVE_BLOCK);
    return data || null;
  }

  async startBlock(name: string, config: TimerConfig): Promise<ActiveBlockData> {
    const startId = crypto.randomUUID() as UUID;

    await this.addBlockEvent(startId, name, 'block_start');

    const activeBlock: ActiveBlockData = {
      startId,
      name,
      startTime: Date.now(),
      elapsed: 0,
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? config.minutes : undefined,
      paused: false,
    };

    await this.env.storage.write(STORAGE_KEYS.ACTIVE_BLOCK, activeBlock);
    this.notifyChange(activeBlock);

    return activeBlock;
  }

  async pauseBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(STORAGE_KEYS.ACTIVE_BLOCK);
    if (!data) return;

    await this.env.storage.write(STORAGE_KEYS.ACTIVE_BLOCK, {
      ...data,
      paused: true,
      pausedAt: Date.now(),
    });

    const block = await this.loadActiveBlock();
    if (block) this.notifyChange(block);
  }

  async resumeBlock(): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(STORAGE_KEYS.ACTIVE_BLOCK);
    if (!data || !data.paused) return;

    await this.env.storage.write(STORAGE_KEYS.ACTIVE_BLOCK, {
      ...data,
      paused: false,
      pausedAt: undefined,
    });

    const block = await this.loadActiveBlock();
    if (block) this.notifyChange(block);
  }

  async endBlock(feedback?: string): Promise<TimeBlock | null> {
    const activeData = await this.env.storage.read<ActiveBlockData>(STORAGE_KEYS.ACTIVE_BLOCK);
    if (!activeData) return null;

    const endId = crypto.randomUUID() as UUID;
    const eventContent = feedback || `${activeData.name} 完成`;
    await this.addBlockEvent(endId, eventContent, 'block_end', feedback);

    const timeBlock: TimeBlockData = {
      id: activeData.startId,
      name: activeData.name,
      startId: activeData.startId,
      endId,
      note: feedback,
      tags: ['block_feedback'],
      startTime: activeData.startTime,
      endTime: Date.now(),
    };

    const completed = await this.env.storage.read<TimeBlockData[]>(STORAGE_KEYS.TIME_BLOCKS) || [];
    completed.push(timeBlock);
    await this.env.storage.write(STORAGE_KEYS.TIME_BLOCKS, completed);
    await this.env.storage.delete(STORAGE_KEYS.ACTIVE_BLOCK);

    this.notifyChange(null);

    return {
      ...timeBlock,
      tags: new Set(timeBlock.tags),
    };
  }

  async updateElapsed(elapsed: number): Promise<void> {
    const data = await this.env.storage.read<ActiveBlockData>(STORAGE_KEYS.ACTIVE_BLOCK);
    if (!data || data.paused) return;

    await this.env.storage.write(STORAGE_KEYS.ACTIVE_BLOCK, {
      ...data,
      elapsed,
    });
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async addBlockEvent(
    eventId: UUID,
    content: string,
    tag: 'block_start' | 'block_end',
    _feedback?: string
  ): Promise<Event> {
    const tags: string[] = [tag];
    if (tag === 'block_end') {
      tags.push('block_feedback');
    }

    const eventData: EventData = {
      id: eventId,
      timestamp: Date.now(),
      content,
      tags,
    };

    const events = await this.env.storage.read<EventData[]>(STORAGE_KEYS.EVENTS) || [];
    events.unshift(eventData);
    await this.env.storage.write(STORAGE_KEYS.EVENTS, events);

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

export function getTimeBlockService(env?: ExoMindEnvironment): TimeBlockService {
  const effectiveEnv = env || ExoMindEnvironment.getInstance();
  if (!timeBlockServiceInstance) {
    timeBlockServiceInstance = new TimeBlockServiceImpl(effectiveEnv);
  }
  return timeBlockServiceInstance;
}
