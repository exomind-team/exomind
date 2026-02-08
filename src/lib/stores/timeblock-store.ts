/**
 * TimeBlock Store 兼容层
 * 临时支持 ChatPage 等使用旧 API 的组件
 *
 * @deprecated 请迁移到新的 @/lib/timeblock 模块
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { TimeBlock } from '@/lib/timeblock';

// ============================================================================
// 类型定义（兼容旧 API）
// ============================================================================

export type UUID = string;
export type Timestamp = number;

export interface TimeBlockEvent {
  readonly id: UUID;
  readonly timestamp: Timestamp;
  readonly _content: string;
  readonly _tags: string[];
}

export interface PlannedTimeBlockImplData {
  readonly id: UUID;
  readonly startId: UUID;
  readonly endId?: UUID;
  readonly name: string;
  readonly _note?: string;
  readonly _events: TimeBlockEvent[];
}

export type Tag = string;

// ============================================================================
// Store
// ============================================================================

interface TimeBlockStore {
  // 数据
  events: TimeBlockEvent[];
  timeBlocks: PlannedTimeBlockImplData[];

  // 当前活跃块
  activeBlock: PlannedTimeBlockImplData | null;

  // Actions
  addEvent: (content: string, tags?: Tag[]) => void;
  startBlock: (name: string) => void;
  endBlock: () => PlannedTimeBlockImplData | null;
  getEventsInBlock: (block: PlannedTimeBlockImplData) => TimeBlockEvent[];
  getTimeBlocksByStartTime: () => PlannedTimeBlockImplData[];
  load: () => void;
  save: () => void;
  reset: () => void;
}

export const useTimeBlockStore = create<TimeBlockStore>()(
  persist(
    (set, get) => ({
      events: [],
      timeBlocks: [],
      activeBlock: null,

      addEvent: (content: string, tags?: Tag[]) => {
        const event: TimeBlockEvent = {
          id: uuidv4(),
          timestamp: Date.now(),
          _content: content,
          _tags: tags || [],
        };
        set((state) => {
          const newEvents = [...state.events, event];

          // 如果有活跃块，添加到块中
          if (state.activeBlock) {
            const updatedBlock: PlannedTimeBlockImplData = {
              ...state.activeBlock,
              _events: [...state.activeBlock._events, event],
            };
            return {
              events: newEvents,
              activeBlock: updatedBlock,
              timeBlocks: state.timeBlocks.map((b) =>
                b.id === updatedBlock.id ? updatedBlock : b
              ),
            };
          }

          return { events: newEvents };
        });
      },

      startBlock: (name: string) => {
        const startEvent: TimeBlockEvent = {
          id: uuidv4(),
          timestamp: Date.now(),
          _content: `开始时间块: ${name}`,
          _tags: ['block_start', name],
        };

        const block: PlannedTimeBlockImplData = {
          id: uuidv4(),
          startId: startEvent.id,
          name,
          _events: [startEvent],
        };

        set((state) => ({
          events: [...state.events, startEvent],
          activeBlock: block,
          timeBlocks: [...state.timeBlocks, block],
        }));
      },

      endBlock: () => {
        const state = get();
        if (!state.activeBlock) return null;

        const endEvent: TimeBlockEvent = {
          id: uuidv4(),
          timestamp: Date.now(),
          _content: `结束时间块: ${state.activeBlock.name}`,
          _tags: ['block_end'],
        };

        const completedBlock: PlannedTimeBlockImplData = {
          ...state.activeBlock,
          endId: endEvent.id,
          _events: [...state.activeBlock._events, endEvent],
        };

        set((s) => ({
          events: [...s.events, endEvent],
          activeBlock: null,
          timeBlocks: s.timeBlocks.map((b) =>
            b.id === completedBlock.id ? completedBlock : b
          ),
        }));

        return completedBlock;
      },

      getEventsInBlock: (block: PlannedTimeBlockImplData) => {
        return get().events.filter(
          (e) => e.timestamp >= get().events.find((ev) => ev.id === block.startId)?.timestamp! &&
                 e.timestamp <= (block.endId
                   ? get().events.find((ev) => ev.id === block.endId)?.timestamp!
                   : Date.now())
        );
      },

      getTimeBlocksByStartTime: () => {
        return [...get().timeBlocks].sort(
          (a, b) =>
            get().events.find((e) => e.id === a.startId)?.timestamp! -
            get().events.find((e) => e.id === b.startId)?.timestamp!
        );
      },

      load: () => {
        // 持久化存储已自动加载
      },

      save: () => {
        // Zustand persist 会自动保存
      },

      reset: () => {
        set({ events: [], timeBlocks: [], activeBlock: null });
      },
    }),
    {
      name: 'timeblock-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        events: state.events,
        timeBlocks: state.timeBlocks,
      }),
    }
  )
);

// ============================================================================
// 命令解析（兼容旧 API）
// ============================================================================

export interface TimeBlockCommand {
  type: 'start' | 'end' | 'none';
  name?: string;
}

export function parseTimeBlockCommand(input: string): TimeBlockCommand {
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

// ============================================================================
// 便捷转换函数（供 Timeline 页面使用）
// ============================================================================

/**
 * 将 PlannedTimeBlockImplData 转换为新的 TimeBlock 格式
 */
export function toTimeBlock(
  block: PlannedTimeBlockImplData,
  _events: TimeBlockEvent[]
): TimeBlock {
  return {
    id: block.id,
    name: block.name,
    note: block._note,
    startId: block.startId,
    endId: block.endId,
    tags: new Set(block._events.flatMap(e => e._tags)),
  };
}

/**
 * 从新的 TimeBlock 格式创建 PlannedTimeBlockImplData
 */
export function fromTimeBlock(block: TimeBlock): PlannedTimeBlockImplData {
  return {
    id: block.id,
    startId: block.startId,
    name: block.name,
    _note: block.note,
    _events: [],
  };
}
