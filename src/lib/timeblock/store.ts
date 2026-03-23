/**
 * TimeBlock Store - zustand 状态管理
 *
 * 基于 MVP-ARCHITECTURE.md 文档
 * @module timeblock/store
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  UUID,
  Tag,
  NoteContent,
  Event,
  TimeBlock,
  PlannedTimeBlock,
} from './types';
import { EventImpl, TimeBlockImpl } from './types';
import { log } from '@/lib/logger';

// ============================================================================
// Store 接口
// ============================================================================

interface TimeBlockStore {
  // 数据
  events: Map<UUID, Event>;
  timeBlocks: Map<UUID, TimeBlock>;

  // 当前活跃块
  activeBlock: PlannedTimeBlock | null;

  // 加载状态
  isLoaded: boolean;

  // Actions - 事件管理
  addEvent: (content: NoteContent, tags?: Tag[]) => Event;
  getEventById: (id: UUID) => Event | undefined;
  getAllEvents: () => Event[];
  getEventsByTime: () => IterableIterator<Event>;

  // Actions - 时间块管理
  startBlock: (name: string, tags?: Tag[]) => TimeBlock;
  endBlock: (note?: string) => TimeBlock | null;
  getBlockById: (id: UUID) => TimeBlock | undefined;
  getAllBlocks: () => TimeBlock[];
  getBlocksByTime: () => IterableIterator<TimeBlock>;
  eventsInBlock: (block: TimeBlock) => Event[];

  // Actions - 查询
  getTodayBlocks: () => TimeBlock[];

  // Actions - 持久化
  save: () => void;
  load: () => void;
  reset: () => void;

  // Actions - 内部
  _setEvents: (events: Map<UUID, Event>) => void;
  _setBlocks: (blocks: Map<UUID, TimeBlock>) => void;
}

// ============================================================================
// Store 实现
// ============================================================================

export const useTimeBlockStore = create<TimeBlockStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      events: new Map(),
      timeBlocks: new Map(),
      activeBlock: null,
      isLoaded: false,

      // Actions - 事件管理
      addEvent: (content: NoteContent, tags?: Tag[]) => {
        const event = new EventImpl(content, tags);
        set((state) => {
          const newEvents = new Map(state.events);
          newEvents.set(event.id, event);
          return { events: newEvents };
        });
        get().save();
        return event;
      },

      getEventById: (id: UUID) => {
        return get().events.get(id);
      },

      getAllEvents: () => {
        return Array.from(get().events.values());
      },

      getEventsByTime: function* (): IterableIterator<Event> {
        const events = Array.from(get().events.values());
        events.sort((a, b) => a.timestamp - b.timestamp);
        yield* events;
      },

      // Actions - 时间块管理
      startBlock: (name: string, tags?: Tag[]) => {
        const state = get();

        // 如果已有活跃块，先结束它
        if (state.activeBlock) {
          get().endBlock();
        }

        // 创建开始事件
        const startEvent = new EventImpl(
          `开始时间块 "${name}"`,
          [...(tags || []), 'block_start', name]
        );

        // 创建时间块
        const block = new TimeBlockImpl(name, startEvent.id, tags);

        // 创建计划块
        const plannedBlock: PlannedTimeBlock = {
          startId: startEvent.id,
          name,
          tags: new Set(tags || []),
        };

        // 更新状态
        set((state) => {
          const newEvents = new Map(state.events);
          newEvents.set(startEvent.id, startEvent);

          const newBlocks = new Map(state.timeBlocks);
          newBlocks.set(block.id, block);

          return {
            events: newEvents,
            timeBlocks: newBlocks,
            activeBlock: plannedBlock,
          };
        });

        get().save();
        return block;
      },

      endBlock: (note?: string) => {
        const state = get();
        if (!state.activeBlock) {
          return null;
        }

        const startEvent = state.events.get(state.activeBlock.startId);
        if (!startEvent) {
          return null;
        }

        // 创建结束事件
        const endEvent = new EventImpl(
          `结束时间块 "${state.activeBlock.name}"`,
          ['block_end', state.activeBlock.name]
        );

        // 更新时间块
        const block = state.timeBlocks.get(
          Array.from(state.timeBlocks.values()).find(
            (b) => b.startId === state.activeBlock!.startId
          )?.id!
        );

        if (!block) {
          return null;
        }

        // 设置结束事件和记录
        block.endId = endEvent.id;
        block.note = note;

        // 更新状态
        set((state) => {
          const newEvents = new Map(state.events);
          newEvents.set(endEvent.id, endEvent);

          const newBlocks = new Map(state.timeBlocks);
          newBlocks.set(block.id, block);

          return {
            events: newEvents,
            timeBlocks: newBlocks,
            activeBlock: null,
          };
        });

        get().save();
        return block;
      },

      getBlockById: (id: UUID) => {
        return get().timeBlocks.get(id);
      },

      getAllBlocks: () => {
        return Array.from(get().timeBlocks.values());
      },

      getBlocksByTime: function* (): IterableIterator<TimeBlock> {
        const blocks = Array.from(get().timeBlocks.values());
        blocks.sort((a, b) => {
          const aStart = get().events.get(a.startId)?.timestamp || 0;
          const bStart = get().events.get(b.startId)?.timestamp || 0;
          return aStart - bStart;
        });
        yield* blocks;
      },

      eventsInBlock: (block: TimeBlock) => {
        const state = get();
        const startEvent = state.events.get(block.startId);
        if (!startEvent) return [];

        const startTime = startEvent.timestamp;
        const endTime = block.endId
          ? state.events.get(block.endId)?.timestamp || Date.now()
          : Date.now();

        return Array.from(state.events.values()).filter(
          (e) => e.timestamp >= startTime && e.timestamp <= endTime
        );
      },

      // Actions - 查询
      getTodayBlocks: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        return Array.from(get().timeBlocks.values()).filter((block) => {
          const startEvent = get().events.get(block.startId);
          if (!startEvent) return false;
          return startEvent.timestamp >= today.getTime() && startEvent.timestamp < tomorrow.getTime();
        });
      },

      // Actions - 持久化
      save: () => {
        const state = get();

        // 保存到 localStorage
        const data = {
          events: Array.from(state.events.values()).map((e) => {
            if (e instanceof EventImpl) {
              return e.toJSON();
            }
            return e;
          }),
          blocks: Array.from(state.timeBlocks.values()).map((b) => {
            if (b instanceof TimeBlockImpl) {
              return b.toJSON();
            }
            return b;
          }),
          activeBlock: state.activeBlock,
        };

        localStorage.setItem('timeblock-data', JSON.stringify(data));
      },

      load: () => {
        const dataStr = localStorage.getItem('timeblock-data');
        if (!dataStr) {
          set({ isLoaded: true });
          return;
        }

        try {
          const data = JSON.parse(dataStr);

          const events = new Map<UUID, Event>();
          (data.events as unknown[]).forEach((e) => {
            const event = EventImpl.fromJSON(e as Record<string, unknown>);
            events.set(event.id, event);
          });

          const blocks = new Map<UUID, TimeBlock>();
          (data.blocks as unknown[]).forEach((b) => {
            const block = TimeBlockImpl.fromJSON(b as Record<string, unknown>);
            blocks.set(block.id, block);
          });

          set({
            events,
            timeBlocks: blocks,
            activeBlock: data.activeBlock || null,
            isLoaded: true,
          });
        } catch (error) {
          log.error(`Failed to load timeblock data: ${error instanceof Error ? error.message : String(error)}`);
          set({ isLoaded: true });
        }
      },

      reset: () => {
        set({
          events: new Map(),
          timeBlocks: new Map(),
          activeBlock: null,
          isLoaded: false,
        });
        localStorage.removeItem('timeblock-data');
      },

      // Actions - 内部
      _setEvents: (events: Map<UUID, Event>) => {
        set({ events });
      },

      _setBlocks: (blocks: Map<UUID, TimeBlock>) => {
        set({ timeBlocks: blocks });
      },
    }),
    {
      name: 'timeblock-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // 只持久化必要数据
        events: Array.from(state.events.values()).map((e) =>
          e instanceof EventImpl ? e.toJSON() : e
        ),
        blocks: Array.from(state.timeBlocks.values()).map((b) =>
          b instanceof TimeBlockImpl ? b.toJSON() : b
        ),
        activeBlock: state.activeBlock,
      }),
      merge: (persisted, current) => {
        try {
          const events = new Map<UUID, Event>();
          ((persisted as { events?: unknown[] })?.events || []).forEach((e) => {
            const event = EventImpl.fromJSON(e as Record<string, unknown>);
            events.set(event.id, event);
          });

          const blocks = new Map<UUID, TimeBlock>();
          ((persisted as { blocks?: unknown[] })?.blocks || []).forEach((b) => {
            const block = TimeBlockImpl.fromJSON(b as Record<string, unknown>);
            blocks.set(block.id, block);
          });

          return {
            ...current,
            events,
            blocks,
            activeBlock: (persisted as { activeBlock?: PlannedTimeBlock })?.activeBlock || null,
            isLoaded: true,
          };
        } catch {
          return current;
        }
      },
    }
  )
);

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 初始化 Store（加载数据）
 */
export function initTimeBlockStore(): void {
  const store = useTimeBlockStore.getState();
  if (!store.isLoaded) {
    store.load();
  }
}

/**
 * 检查是否有活跃时间块
 */
export function hasActiveBlock(): boolean {
  return useTimeBlockStore.getState().activeBlock !== null;
}

/**
 * 获取活跃时间块
 */
export function getActiveBlock(): PlannedTimeBlock | null {
  return useTimeBlockStore.getState().activeBlock;
}

/**
 * 解析时间块命令
 */
export function parseTimeBlockCommand(input: string): { type: 'start' | 'end' | 'none'; name?: string } {
  const trimmed = input.trim();

  // 解析 "开始xxx" 或 "开始 xxx"
  const startMatch = trimmed.match(/^开始\s*(\S+.*)$/);
  if (startMatch) {
    return { type: 'start', name: startMatch[1].trim() };
  }

  // 解析 "开始" 后跟名称
  if (trimmed === '开始' || trimmed === 'start') {
    return { type: 'start', name: '未命名' };
  }

  // 解析 "结束" 或 "end"
  if (trimmed === '结束' || trimmed === 'end') {
    return { type: 'end' };
  }

  return { type: 'none' };
}
