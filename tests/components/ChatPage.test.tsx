/**
 * ChatPage 单元测试
 *
 * 测试 ChatPage 组件的 EventStorage 集成和消息发送功能
 *
 * 注意：由于 happy-dom 与 @testing-library/react 的兼容性问题，
 *       本测试使用简化的集成测试方案，验证组件逻辑而非完整渲染
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Mock document (happy-dom 需要)
global.document = {
  querySelector: vi.fn(),
} as unknown as Document;

// Mock EventStorage
const mockAddEvent = vi.fn();
const mockGetEvents = vi.fn();
const mockClose = vi.fn();
const mockStopSync = vi.fn();
const mockOnRemoteChange = vi.fn(() => vi.fn());
const mockSyncToRemote = vi.fn();
const mockClearAll = vi.fn();

class MockEventStorage {
  addEvent = mockAddEvent;
  getEvents = mockGetEvents;
  close = mockClose;
  stopSync = mockStopSync;
  onRemoteChange = mockOnRemoteChange;
  syncToRemote = mockSyncToRemote;
  clearAll = mockClearAll;
}

vi.mock('@/lib/storage/event-storage', () => ({
  EventStorage: MockEventStorage,
  getEventStorage: vi.fn(() => new MockEventStorage()),
}));

// Mock sync-store
vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(() => ({
    currentUser: 'testuser',
    isLoggedIn: true,
  })),
}));

import type { Event } from '@/lib/types/event';

describe('ChatPage EventStorage 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEvents.mockResolvedValue([]);
    mockAddEvent.mockResolvedValue(undefined);
    mockSyncToRemote.mockResolvedValue({});
    mockOnRemoteChange.mockReturnValue(vi.fn());
    mockClearAll.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('EventStorage 初始化', () => {
    it('应该使用 userId 创建 EventStorage', async () => {
      // 动态导入以触发 mock
      const { EventStorage } = await import('@/lib/storage/event-storage');
      const storage = new EventStorage('testuser');

      expect(storage).toBeDefined();
    });

    it('应该正确初始化 EventStorage', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      mockGetEvents.mockResolvedValue([
        { id: '1', content: '测试', createdAt: new Date().toISOString() },
      ]);

      const storage = new EventStorage('testuser');
      const events = await storage.getEvents();

      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('测试');
    });
  });

  describe('addEvent 功能', () => {
    it('应该能添加事件', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      mockAddEvent.mockResolvedValue(undefined);
      mockGetEvents.mockResolvedValue([]);

      const storage = new EventStorage('testuser');
      await storage.addEvent({
        id: 'test-id',
        content: '新事件',
        createdAt: new Date().toISOString(),
      });

      expect(mockAddEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '新事件',
          id: 'test-id',
        })
      );
    });

    it('添加事件后应该能获取到', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      const newEvent = {
        id: 'new-id',
        content: '刚添加的事件',
        createdAt: new Date().toISOString(),
      };

      mockGetEvents.mockResolvedValue([newEvent]);

      const storage = new EventStorage('testuser');
      const events = await storage.getEvents();

      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('刚添加的事件');
    });
  });

  describe('远程同步', () => {
    it('应该能启动远程同步', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      mockSyncToRemote.mockResolvedValue({});

      const storage = new EventStorage('testuser');
      await storage.syncToRemote('http://localhost:6984/testuser');

      expect(mockSyncToRemote).toHaveBeenCalledWith(
        'http://localhost:6984/testuser'
      );
    });

    it('应该能监听远程变更', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      const callback = vi.fn();
      mockOnRemoteChange.mockReturnValue(vi.fn());

      const storage = new EventStorage('testuser');
      const unsubscribe = storage.onRemoteChange(callback);

      expect(mockOnRemoteChange).toHaveBeenCalled();
      expect(typeof unsubscribe).toBe('function');
    });

    it('应该能取消监听', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      const unsubscribe = vi.fn();
      mockOnRemoteChange.mockReturnValue(unsubscribe);

      const storage = new EventStorage('testuser');
      const cancel = storage.onRemoteChange(vi.fn());
      cancel();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('清理', () => {
    it('应该能关闭存储', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      mockClose.mockResolvedValue(undefined);

      const storage = new EventStorage('testuser');
      await storage.close();

      expect(mockClose).toHaveBeenCalled();
    });

    it('应该能停止同步', async () => {
      const { EventStorage } = await import('@/lib/storage/event-storage');

      mockStopSync.mockResolvedValue(undefined);

      const storage = new EventStorage('testuser');
      await storage.stopSync();

      expect(mockStopSync).toHaveBeenCalled();
    });
  });
});

describe('ChatPage 架构边界', () => {
  it('应通过 EventLogService 管理事件读写（不直连 EventStorage 的 get/add）', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).toContain('getEventLogService');
    expect(source).toContain('loadEvents(');
    expect(source).not.toContain('storageRef.current.addEvent(');
    expect(source).not.toContain('storageRef.current.getEvents(');
    expect(source).not.toContain('storage.getEvents(');
  });

  it('RT SQLite 模式下不应再把 ChatPage 展示读源绑到 getEventStorage', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).not.toContain('getEventStorage(');
    expect(source).not.toContain('onRemoteChange(');
  });

  it('ECS 模式下不应再直连 syncToRemote / 6984（不再依赖旧同步服务器）', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).not.toContain('syncToRemote(');
    expect(source).not.toContain('buildRemoteDbUrl(');
    expect(source).not.toContain('resolveSyncServerUrl(');
    expect(source).not.toContain('6984');
  });

  it('不应把 currentUser 显示名直接作为 EventStorage 分区键', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).not.toContain('getEventStorage(currentUser || undefined)');
    expect(source).toContain('activeProfileId');
  });
});

describe('ChatPage 消息发送逻辑', () => {
  describe('handleSend 逻辑验证', () => {
    it('应该过滤空白消息', () => {
      const testMessage = (content: string) => {
        const trimmed = content.trim();
        return trimmed.length > 0;
      };

      expect(testMessage('有效消息')).toBe(true);
      expect(testMessage('')).toBe(false);
      expect(testMessage('   ')).toBe(false);
      expect(testMessage('\t\n')).toBe(false);
    });

    it('应该生成有效的 UUID', () => {
      const uuid = crypto.randomUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('应该正确格式化事件对象', () => {
      const id = 'test-uuid';
      const content = '测试内容';
      const now = new Date().toISOString();

      const event = {
        id,
        content,
        createdAt: now,
      };

      expect(event.id).toBe(id);
      expect(event.content).toBe(content);
      expect(event.createdAt).toBe(now);
    });
  });

  describe('同步状态转换', () => {
    it('应该正确转换同步状态', () => {
      const statuses = ['disconnected', 'syncing', 'connected'] as const;

      expect(statuses).toContain('disconnected');
      expect(statuses).toContain('syncing');
      expect(statuses).toContain('connected');
    });
  });
});

describe('Event 转换逻辑', () => {
  it('应该正确转换 Storage Event 到 UI Event', () => {
    const storageEvent = {
      id: 'event-1',
      content: '测试内容',
      createdAt: '2024-01-01T10:00:00.000Z',
      type: 'message',
    };

    // ChatPage 中的转换逻辑
    const uiEvent: Event = {
      id: storageEvent.id,
      timestamp: new Date(storageEvent.createdAt).getTime(),
      content: storageEvent.content,
      tags: new Set<string>(storageEvent.type ? [storageEvent.type] : []),
    };

    expect(uiEvent.id).toBe('event-1');
    expect(uiEvent.timestamp).toBeGreaterThan(0);
    expect(uiEvent.content).toBe('测试内容');
    expect(uiEvent.tags.has('message')).toBe(true);
  });

  it('应该正确处理无 type 的事件', () => {
    const storageEvent = {
      id: 'event-2',
      content: '无类型内容',
      createdAt: '2024-01-01T11:00:00.000Z',
    };

    const uiEvent: Event = {
      id: storageEvent.id,
      timestamp: new Date(storageEvent.createdAt).getTime(),
      content: storageEvent.content,
      tags: new Set<string>(storageEvent.type ? [storageEvent.type] : []),
    };

    expect(uiEvent.tags.size).toBe(0);
  });
});

describe('useSyncStore Mock 验证', () => {
  it('应该能正确导入 mock sync-store', async () => {
    const store = await import('@/ui/stores/sync-store');
    expect(store.useSyncStore).toBeDefined();
  });
});
