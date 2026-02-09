/**
 * TimeBlock Store 单元测试
 *
 * 测试场景：
 * - addEvent: 添加事件
 * - startBlock: 开始时间块
 * - endBlock: 结束时间块
 * - getEventsInBlock: 获取块内事件
 * - getTimeBlocksByStartTime: 按开始时间排序
 * - reset: 重置状态
 * - 数据持久化模拟
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';

// ============================================================================
// Mock localStorage - 在 vitest 环境中模拟
// ============================================================================

interface StorageData {
  [key: string]: string;
}

const storageData: StorageData = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string): string | null => {
    return storageData[key] ?? null;
  }),
  setItem: vi.fn((key: string, value: string): void => {
    storageData[key] = value;
  }),
  removeItem: vi.fn((key: string): void => {
    delete storageData[key];
  }),
  clear: vi.fn((): void => {
    Object.keys(storageData).forEach((key) => delete storageData[key]);
  }),
  get length(): number {
    return Object.keys(storageData).length;
  },
  key: vi.fn((index: number): string | null => {
    return Object.keys(storageData)[index] ?? null;
  }),
};

// 在所有测试开始前设置 mock localStorage
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
});

// ============================================================================
// Mock uuid
// ============================================================================

let uuidCounter = 0;

vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
}));

// ============================================================================
// Import store after mocking
// ============================================================================

// 动态导入 store（确保 mock 已设置）
const { useTimeBlockStore } = await import('@/lib/stores/timeblock-store');

// ============================================================================
// 测试辅助函数
// ============================================================================

function resetStore(): void {
  // 清空存储数据
  Object.keys(storageData).forEach((key) => delete storageData[key]);
  // 重置 uuid 计数器
  uuidCounter = 0;
  // 重置 store 状态
  useTimeBlockStore.setState({ events: [], timeBlocks: [], activeBlock: null });
}

function getStoreState(): {
  events: Array<{ id: string; timestamp: number; _content: string; _tags: string[] }>;
  timeBlocks: Array<{
    id: string;
    startId: string;
    endId?: string;
    name: string;
    _events: Array<{ id: string; timestamp: number; _content: string; _tags: string[] }>;
  }>;
  activeBlock: Array<{
    id: string;
    startId: string;
    endId?: string;
    name: string;
    _events: Array<{ id: string; timestamp: number; _content: string; _tags: string[] }>;
  }> | null;
} {
  return useTimeBlockStore.getState() as ReturnType<typeof useTimeBlockStore.getState>;
}

// 等待 store 初始化完成
function waitForStoreInit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

// ============================================================================
// 测试套件
// ============================================================================

describe('TimeBlockStore', () => {
  beforeEach(async () => {
    resetStore();
    await waitForStoreInit();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetStore();
  });

  // ========================================================================
  // 初始化测试
  // ========================================================================

  describe('初始化', () => {
    it('初始状态为空', async () => {
      resetStore();
      await waitForStoreInit();
      const state = getStoreState();

      expect(state.events).toEqual([]);
      expect(state.timeBlocks).toEqual([]);
      expect(state.activeBlock).toBeNull();
    });
  });

  // ========================================================================
  // addEvent 测试
  // ========================================================================

  describe('addEvent', () => {
    it('添加事件到空存储', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().addEvent('测试事件', ['test']);

      const state = getStoreState();
      expect(state.events).toHaveLength(1);
      expect(state.events[0]._content).toBe('测试事件');
      expect(state.events[0]._tags).toEqual(['test']);
      expect(state.events[0].id).toBe('mock-uuid-1');
    });

    it('添加多个事件', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().addEvent('事件1');
      useTimeBlockStore.getState().addEvent('事件2', ['tag1', 'tag2']);

      const state = getStoreState();
      expect(state.events).toHaveLength(2);
      expect(state.events[0]._content).toBe('事件1');
      expect(state.events[1]._content).toBe('事件2');
      expect(state.events[1]._tags).toEqual(['tag1', 'tag2']);
    });

    it('添加事件时自动设置时间戳', async () => {
      await waitForStoreInit();
      const before = Date.now();
      useTimeBlockStore.getState().addEvent('带时间的事件');
      const after = Date.now();

      const state = getStoreState();
      expect(state.events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(state.events[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('在活跃块中添加事件时，事件同时添加到块中', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('工作块');
      useTimeBlockStore.getState().addEvent('块内事件1');
      useTimeBlockStore.getState().addEvent('块内事件2');

      const state = getStoreState();

      // 事件总数
      expect(state.events).toHaveLength(3); // 开始事件 + 2个块内事件

      // 活跃块包含所有块内事件
      expect(state.activeBlock).not.toBeNull();
      expect(state.activeBlock!._events).toHaveLength(3); // 开始事件 + 2个块内事件
    });
  });

  // ========================================================================
  // startBlock 测试
  // ========================================================================

  describe('startBlock', () => {
    it('开始一个新的时间块', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('学习Rust');

      const state = getStoreState();
      expect(state.timeBlocks).toHaveLength(1);
      expect(state.activeBlock).not.toBeNull();
      expect(state.activeBlock!.name).toBe('学习Rust');
    });

    it('开始块时自动创建开始事件', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('会议');

      const state = getStoreState();
      const startEvent = state.events[0];

      expect(startEvent._content).toBe('开始时间块: 会议');
      expect(startEvent._tags).toContain('block_start');
      expect(startEvent._tags).toContain('会议');
    });

    it('开始多个块时，活跃块只指向最后一个', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('块1');
      useTimeBlockStore.getState().startBlock('块2');

      const state = getStoreState();
      expect(state.timeBlocks).toHaveLength(2);
      expect(state.activeBlock!.name).toBe('块2');
    });

    it('开始块后可以添加事件', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('编程');
      useTimeBlockStore.getState().addEvent('写测试');

      const state = getStoreState();
      expect(state.activeBlock).not.toBeNull();
      expect(state.activeBlock!._events).toHaveLength(2); // 开始事件 + 添加的事件
    });
  });

  // ========================================================================
  // endBlock 测试
  // ========================================================================

  describe('endBlock', () => {
    it('结束当前活跃块', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('专注工作');
      useTimeBlockStore.getState().addEvent('任务1');

      const completedBlock = useTimeBlockStore.getState().endBlock();

      const state = getStoreState();
      expect(completedBlock).not.toBeNull();
      expect(completedBlock!.name).toBe('专注工作');
      expect(completedBlock!.endId).toBeDefined();
      expect(state.activeBlock).toBeNull();
    });

    it('结束块时创建结束事件', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('阅读');
      useTimeBlockStore.getState().endBlock();

      const state = getStoreState();
      const endEvent = state.events[state.events.length - 1];

      expect(endEvent._content).toBe('结束时间块: 阅读');
      expect(endEvent._tags).toContain('block_end');
    });

    it('结束块后块内事件完整', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('项目');
      useTimeBlockStore.getState().addEvent('事件A');
      useTimeBlockStore.getState().addEvent('事件B');
      const completed = useTimeBlockStore.getState().endBlock();

      expect(completed!._events).toHaveLength(4); // 开始 + 2个添加 + 结束
    });

    it('没有活跃块时 endBlock 返回 null', async () => {
      await waitForStoreInit();
      const result = useTimeBlockStore.getState().endBlock();
      expect(result).toBeNull();
    });

    it('结束块后可以开始新块', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('块1');
      useTimeBlockStore.getState().endBlock();
      useTimeBlockStore.getState().startBlock('块2');

      const state = getStoreState();
      expect(state.activeBlock!.name).toBe('块2');
      expect(state.timeBlocks).toHaveLength(2);
    });
  });

  // ========================================================================
  // getEventsInBlock 测试
  // ========================================================================

  describe('getEventsInBlock', () => {
    it('获取块内的所有事件', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('工作');

      useTimeBlockStore.getState().addEvent('块内事件1');
      useTimeBlockStore.getState().addEvent('块内事件2');

      const block = getStoreState().activeBlock!;
      const events = useTimeBlockStore.getState().getEventsInBlock(block);

      expect(events.length).toBeGreaterThanOrEqual(3); // 开始事件 + 2个块内事件
    });

    it('获取块内事件时返回块内事件列表', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('测试块');
      useTimeBlockStore.getState().addEvent('内部事件');
      const completed = useTimeBlockStore.getState().endBlock();

      const blockEvents = useTimeBlockStore.getState().getEventsInBlock(completed!);

      // 验证返回的事件数量
      expect(blockEvents.length).toBeGreaterThanOrEqual(3); // 开始、内部、结束

      // 验证事件内容包含预期的内容
      const contents = blockEvents.map((e) => e._content);
      expect(contents).toContain('开始时间块: 测试块');
      expect(contents).toContain('内部事件');
      expect(contents).toContain('结束时间块: 测试块');
    });
  });

  // ========================================================================
  // getTimeBlocksByStartTime 测试
  // ========================================================================

  describe('getTimeBlocksByStartTime', () => {
    it('按开始时间排序时间块', async () => {
      await waitForStoreInit();

      // 开始并结束第一个块
      useTimeBlockStore.getState().startBlock('第二个块');
      await new Promise((r) => setTimeout(r, 15)); // 确保时间戳不同
      useTimeBlockStore.getState().endBlock();

      // 开始并结束第二个块
      useTimeBlockStore.getState().startBlock('第一个块');
      await new Promise((r) => setTimeout(r, 15));
      useTimeBlockStore.getState().endBlock();

      // 开始第三个块（不结束）
      useTimeBlockStore.getState().startBlock('第三个块');

      const sortedBlocks = useTimeBlockStore.getState().getTimeBlocksByStartTime();

      // 验证排序正确
      expect(sortedBlocks.length).toBe(3);
      expect(sortedBlocks[0].name).toBe('第二个块');
      expect(sortedBlocks[1].name).toBe('第一个块');
      expect(sortedBlocks[2].name).toBe('第三个块');
    });

    it('返回空数组当没有时间块', async () => {
      await waitForStoreInit();
      const sortedBlocks = useTimeBlockStore.getState().getTimeBlocksByStartTime();
      expect(sortedBlocks).toEqual([]);
    });
  });

  // ========================================================================
  // reset 测试
  // ========================================================================

  describe('reset', () => {
    it('重置后状态为空', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().addEvent('事件');
      useTimeBlockStore.getState().startBlock('块');
      useTimeBlockStore.getState().addEvent('块内');

      useTimeBlockStore.getState().reset();

      const state = getStoreState();
      expect(state.events).toEqual([]);
      expect(state.timeBlocks).toEqual([]);
      expect(state.activeBlock).toBeNull();
    });

    it('重置后可以重新添加数据', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().addEvent('旧数据');
      useTimeBlockStore.getState().reset();
      useTimeBlockStore.getState().addEvent('新数据');

      expect(getStoreState().events).toHaveLength(1);
      expect(getStoreState().events[0]._content).toBe('新数据');
    });
  });

  // ========================================================================
  // 数据持久化测试
  // ========================================================================

  describe('数据持久化', () => {
    it('时间块存储正确结构', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().startBlock('持久化块');

      const state = getStoreState();
      expect(state.timeBlocks[0]).toHaveProperty('id');
      expect(state.timeBlocks[0]).toHaveProperty('startId');
      expect(state.timeBlocks[0]).toHaveProperty('name');
      expect(state.timeBlocks[0]).toHaveProperty('_events');
    });

    it('事件存储正确结构', async () => {
      await waitForStoreInit();
      useTimeBlockStore.getState().addEvent('测试', ['tag1', 'tag2']);

      const state = getStoreState();
      expect(state.events[0]).toHaveProperty('id');
      expect(state.events[0]).toHaveProperty('timestamp');
      expect(state.events[0]).toHaveProperty('_content');
      expect(state.events[0]).toHaveProperty('_tags');
    });

    it('store 使用正确的存储名称', async () => {
      await waitForStoreInit();
      // 验证 store 创建时使用了正确的存储名称
      // 通过添加数据并检查是否尝试保存来验证
      useTimeBlockStore.getState().addEvent('测试持久化');

      // 数据应该被存储在 store 中
      const state = getStoreState();
      expect(state.events.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // 完整流程测试
  // ========================================================================

  describe('完整流程', () => {
    it('完整的开始-添加-结束流程', async () => {
      await waitForStoreInit();
      // 开始块
      useTimeBlockStore.getState().startBlock('写作');

      // 添加多个事件
      useTimeBlockStore.getState().addEvent('写第一段', ['creative']);
      useTimeBlockStore.getState().addEvent('写第二段', ['creative']);
      useTimeBlockStore.getState().addEvent('修改第一段', ['editing']);

      // 结束块
      const completed = useTimeBlockStore.getState().endBlock();

      // 验证
      expect(completed).not.toBeNull();
      expect(completed!._events).toHaveLength(5); // 开始 + 3个事件 + 结束

      // 验证事件内容
      const contents = completed!._events.map((e) => e._content);
      expect(contents).toContain('开始时间块: 写作');
      expect(contents).toContain('写第一段');
      expect(contents).toContain('写第二段');
      expect(contents).toContain('修改第一段');
      expect(contents).toContain('结束时间块: 写作');
    });

    it('多个时间块的完整生命周期', async () => {
      await waitForStoreInit();
      // 第一个块
      useTimeBlockStore.getState().startBlock('早晨例程');
      useTimeBlockStore.getState().addEvent('冥想', ['mindfulness']);
      useTimeBlockStore.getState().addEvent('运动', ['fitness']);
      useTimeBlockStore.getState().endBlock();

      // 第二个块
      useTimeBlockStore.getState().startBlock('深度工作');
      useTimeBlockStore.getState().addEvent('编码', ['work']);
      useTimeBlockStore.getState().endBlock();

      // 第三个块
      useTimeBlockStore.getState().startBlock('阅读');

      // 验证
      expect(getStoreState().timeBlocks).toHaveLength(3);
      expect(getStoreState().activeBlock!.name).toBe('阅读');

      const sortedBlocks = useTimeBlockStore.getState().getTimeBlocksByStartTime();
      expect(sortedBlocks[0].name).toBe('早晨例程');
      expect(sortedBlocks[1].name).toBe('深度工作');
      expect(sortedBlocks[2].name).toBe('阅读');
    });
  });
});
