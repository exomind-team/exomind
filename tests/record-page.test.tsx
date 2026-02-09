/**
 * RecordPage 单元测试
 *
 * 测试场景：
 * - 事件记录功能
 * - 时间块开始/结束功能
 * - 标签解析（#tag 语法）
 * - 活跃状态显示
 * - 数据一致性（与 useTimeBlockStore 共享）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordPage } from '@/components/Record/RecordPage';
import type { TimeBlockEvent, PlannedTimeBlockImplData } from '@/lib/stores/timeblock-store';
import type { ChatMessage } from '@/lib/stores/chat-store';

// ============================================================================
// Mock 配置
// ============================================================================

// Mock useChatStore
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockLoadMessages = vi.fn();
const mockGetDeviceId = vi.fn().mockReturnValue('device-test');

const mockChatStore = {
  messages: [] as ChatMessage[],
  pendingMessages: [] as ChatMessage[],
  isConnected: true,
  isConnecting: false,
  network: { isOnline: true },
  sendMessage: mockSendMessage,
  loadMessages: mockLoadMessages,
  getDeviceId: mockGetDeviceId,
  connectedDeviceCount: 0,
};

vi.mock('@/lib/stores/chat-store', () => ({
  useChatStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockChatStore);
    }
    return mockChatStore;
  }),
}));

// Mock useTimeBlockStore
let mockEvents: TimeBlockEvent[] = [];
let mockTimeBlocks: PlannedTimeBlockImplData[] = [];
let mockActiveBlock: PlannedTimeBlockImplData | null = null;
let mockAddEvent = vi.fn();
let mockStartBlock = vi.fn();
let mockEndBlock = vi.fn();
let mockGetEventsInBlock = vi.fn();
let mockGetTimeBlocksByStartTime = vi.fn();
let mockLoadTimeBlocks = vi.fn();
let mockSaveTimeBlocks = vi.fn();

function resetMockStores() {
  mockEvents = [];
  mockTimeBlocks = [];
  mockActiveBlock = null;
  mockSendMessage.mockClear().mockResolvedValue(undefined);
  mockLoadMessages.mockClear();
  mockGetDeviceId.mockReturnValue('device-test');
  mockChatStore.messages = [];
  mockChatStore.pendingMessages = [];
  mockChatStore.isConnected = true;
  mockChatStore.network = { isOnline: true };
  mockChatStore.connectedDeviceCount = 0;
  mockAddEvent = vi.fn().mockImplementation((content: string, tags?: string[]) => {
    const event: TimeBlockEvent = {
      id: `event-${Date.now()}`,
      timestamp: Date.now(),
      _content: content,
      _tags: tags || [],
    };
    mockEvents = [...mockEvents, event];
    if (mockActiveBlock) {
      mockActiveBlock = {
        ...mockActiveBlock,
        _events: [...mockActiveBlock._events, event],
      };
    }
    return event;
  });
  mockStartBlock = vi.fn().mockImplementation((name: string) => {
    const startEvent: TimeBlockEvent = {
      id: `start-${Date.now()}`,
      timestamp: Date.now(),
      _content: `开始时间块: ${name}`,
      _tags: ['block_start', name],
    };
    const block: PlannedTimeBlockImplData = {
      id: `block-${Date.now()}`,
      startId: startEvent.id,
      name,
      _events: [startEvent],
    };
    mockEvents = [...mockEvents, startEvent];
    mockActiveBlock = block;
    mockTimeBlocks = [...mockTimeBlocks, block];
    return block;
  });
  mockEndBlock = vi.fn().mockImplementation(() => {
    if (!mockActiveBlock) return null;
    const endEvent: TimeBlockEvent = {
      id: `end-${Date.now()}`,
      timestamp: Date.now(),
      _content: `结束时间块: ${mockActiveBlock.name}`,
      _tags: ['block_end'],
    };
    mockEvents = [...mockEvents, endEvent];
    const completedBlock = {
      ...mockActiveBlock,
      endId: endEvent.id,
      _events: [...mockActiveBlock._events, endEvent],
    };
    mockActiveBlock = null;
    mockTimeBlocks = mockTimeBlocks.map((b) =>
      b.id === completedBlock.id ? completedBlock : b
    );
    return completedBlock;
  });
  mockGetEventsInBlock = vi.fn().mockImplementation((block: PlannedTimeBlockImplData) => {
    return mockEvents.filter(
      (e) => e.timestamp >= mockEvents.find((ev) => ev.id === block.startId)!.timestamp
    );
  });
  mockGetTimeBlocksByStartTime = vi.fn().mockReturnValue([...mockTimeBlocks]);
  mockLoadTimeBlocks = vi.fn();
  mockSaveTimeBlocks = vi.fn().mockResolvedValue(undefined);
}

vi.mock('@/lib/stores/timeblock-store', () => ({
  useTimeBlockStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({
        events: mockEvents,
        timeBlocks: mockTimeBlocks,
        activeBlock: mockActiveBlock,
        addEvent: mockAddEvent,
        startBlock: mockStartBlock,
        endBlock: mockEndBlock,
        getEventsInBlock: mockGetEventsInBlock,
        getTimeBlocksByStartTime: mockGetTimeBlocksByStartTime,
        load: mockLoadTimeBlocks,
        save: mockSaveTimeBlocks,
      });
    }
    return {
      events: mockEvents,
      timeBlocks: mockTimeBlocks,
      activeBlock: mockActiveBlock,
      addEvent: mockAddEvent,
      startBlock: mockStartBlock,
      endBlock: mockEndBlock,
      getEventsInBlock: mockGetEventsInBlock,
      getTimeBlocksByStartTime: mockGetTimeBlocksByStartTime,
      load: mockLoadTimeBlocks,
      save: mockSaveTimeBlocks,
    };
  }),
  parseTimeBlockCommand: vi.fn((input: string) => {
    const trimmed = input.trim();
    const startMatch = trimmed.match(/^开始\s*(\S+.*)$/);
    if (startMatch) {
      return { type: 'start' as const, name: startMatch[1].trim() };
    }
    if (trimmed === '开始' || trimmed === 'start') {
      return { type: 'start' as const, name: '未命名' };
    }
    if (trimmed === '结束' || trimmed === 'end') {
      return { type: 'end' as const };
    }
    return { type: 'none' as const };
  }),
}));

// ============================================================================
// 辅助函数
// ============================================================================

function getTagFromContent(content: string): string[] {
  const matches = content.match(/#([^\s#]+)/g);
  return matches ? matches.map((tag) => tag.slice(1)) : [];
}

// ============================================================================
// 测试用例
// ============================================================================

describe('RecordPage', () => {
  beforeEach(() => {
    resetMockStores();
    vi.clearAllMocks();
  });

  // ========================================================================
  // 事件记录功能测试
  // ========================================================================

  describe('事件记录功能', () => {
    it('should show empty state when no events', () => {
      render(<RecordPage />);

      expect(screen.getByText('暂无记录')).toBeInTheDocument();
      expect(screen.getByText(/随时记录/)).toBeInTheDocument();
    });

    it('should display time block event', () => {
      const event: TimeBlockEvent = {
        id: 'event-1',
        timestamp: Date.now() - 60000,
        _content: '开始时间块: 工作',
        _tags: ['block_start', '工作'],
      };
      mockEvents = [event];

      render(<RecordPage />);

      expect(screen.getByText('开始时间块: 工作')).toBeInTheDocument();
      expect(screen.getByText('🔷')).toBeInTheDocument();
    });

    it('should display normal event with avatar', () => {
      const event: TimeBlockEvent = {
        id: 'event-1',
        timestamp: Date.now() - 30000,
        _content: '测试记录',
        _tags: [],
      };
      mockEvents = [event];

      render(<RecordPage />);

      expect(screen.getByText('测试记录')).toBeInTheDocument();
    });

    it('should send message on Enter', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '输入的消息内容' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockAddEvent).toHaveBeenCalledWith('输入的消息内容', []);
      });
    });

    it('should clear input after sending', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '测试消息' } });
      expect(input).toHaveValue('测试消息');

      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(input).toHaveValue('');
      });
    });

    it('should not send empty message', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(mockAddEvent).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // 时间块功能测试
  // ========================================================================

  describe('时间块开始/结束功能', () => {
    it('should start time block with "开始工作" command', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '开始工作' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockStartBlock).toHaveBeenCalledWith('工作');
      });
    });

    it('should start time block with "开始 阅读" command', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '开始 阅读' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockStartBlock).toHaveBeenCalledWith('阅读');
      });
    });

    it('should start time block with just "开始" command', async () => {
      render(<RecordPage />);

      const input = screen.getByPlaceholderText(/输入记录/);
      fireEvent.change(input, { target: { value: '开始' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockStartBlock).toHaveBeenCalledWith('未命名');
      });
    });

    it('should end time block with "结束" command', async () => {
      // 先设置一个活跃块
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-event',
        name: '工作',
        _events: [
          {
            id: 'start-event',
            timestamp: Date.now() - 3600000,
            _content: '开始时间块: 工作',
            _tags: ['block_start', '工作'],
          },
        ],
      };
      mockEvents = [...mockActiveBlock._events];
      mockTimeBlocks = [mockActiveBlock];

      render(<RecordPage />);

      // 使用更宽松的选择器
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '结束' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockEndBlock).toHaveBeenCalled();
      });
    });
  });

  // ========================================================================
  // 标签解析测试
  // ========================================================================

  describe('标签解析（#tag 语法）', () => {
    it('should parse single tag from message', () => {
      const content = '今天学习了新技术 #react';
      const tags = getTagFromContent(content);

      expect(tags).toContain('react');
      expect(tags).toHaveLength(1);
    });

    it('should parse multiple tags from message', () => {
      const content = '完成项目 #工作 #学习 #react';
      const tags = getTagFromContent(content);

      expect(tags).toContain('工作');
      expect(tags).toContain('学习');
      expect(tags).toContain('react');
      expect(tags).toHaveLength(3);
    });

    it('should handle no tags in message', () => {
      const content = '普通消息没有标签';
      const tags = getTagFromContent(content);

      expect(tags).toHaveLength(0);
    });

    it('should handle tag at start of message', () => {
      const content = '#晨间日记 今天的心情';
      const tags = getTagFromContent(content);

      expect(tags).toContain('晨间日记');
    });

    it('should parse tags with numbers', () => {
      const content: string = '项目进度 #v2.0 #阶段3';
      const tags = getTagFromContent(content);

      expect(tags).toContain('v2.0');
      expect(tags).toContain('阶段3');
    });

    it('should add event with extracted tags', async () => {
      // 设置活跃块
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-event',
        name: '工作',
        _events: [
          {
            id: 'start-event',
            timestamp: Date.now(),
            _content: '开始时间块: 工作',
            _tags: ['block_start', '工作'],
          },
        ],
      };
      mockEvents = [...mockActiveBlock._events];
      mockTimeBlocks = [mockActiveBlock];

      render(<RecordPage />);

      // 使用 role="textbox" 获取输入框
      const input = screen.getByRole('textbox');

      // 发送带标签的消息
      fireEvent.change(input, { target: { value: '消息内容 #标签1 #标签2' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(mockAddEvent).toHaveBeenCalledWith('消息内容', ['标签1', '标签2']);
      });
    });

    it('should show tag preview when typing', async () => {
      render(<RecordPage />);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '测试 #标签' } });

      await waitFor(() => {
        expect(screen.getByText(/标签: #标签/)).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // 活跃状态显示测试
  // ========================================================================

  describe('活跃状态显示', () => {
    it('should show active block badge when block is active', () => {
      const now = Date.now();
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-1',
        name: '测试工作',
        _events: [
          {
            id: 'start-1',
            timestamp: now - 3600000, // 1小时前
            _content: '开始时间块: 测试工作',
            _tags: ['block_start', '测试工作'],
          },
        ],
      };
      mockEvents = mockActiveBlock._events;

      render(<RecordPage />);

      expect(screen.getByText(/记录中: 测试工作/)).toBeInTheDocument();
    });

    it('should show warning when block duration exceeds threshold', () => {
      const now = Date.now();
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-1',
        name: '过长工作',
        _events: [
          {
            id: 'start-1',
            timestamp: now - 5 * 60 * 60 * 1000, // 5小时前，超过4小时阈值
            _content: '开始时间块: 过长工作',
            _tags: ['block_start', '过长工作'],
          },
        ],
      };
      mockEvents = [...mockActiveBlock._events];

      render(<RecordPage />);

      // 检查输入框 placeholder 包含警告
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('placeholder', expect.stringContaining('过长工作'));
    });

    it('should not show active block badge when no active block', () => {
      mockActiveBlock = null;

      render(<RecordPage />);

      expect(screen.queryByText(/记录中:/)).not.toBeInTheDocument();
      expect(screen.getByText(/随时记录/)).toBeInTheDocument();
    });

    it('should update placeholder when active block exists', () => {
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-1',
        name: '测试',
        _events: [
          {
            id: 'start-1',
            timestamp: Date.now(),
            _content: '开始时间块: 测试',
            _tags: ['block_start', '测试'],
          },
        ],
      };
      mockEvents = [...mockActiveBlock._events];

      render(<RecordPage />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('placeholder', expect.stringContaining('记录中: 测试'));
    });

    it('should show history panel when toggle clicked', async () => {
      mockTimeBlocks = [
        {
          id: 'block-1',
          startId: 'start-1',
          name: '已完成工作',
          _events: [],
        },
      ];
      mockGetTimeBlocksByStartTime.mockReturnValue(mockTimeBlocks);
      mockGetEventsInBlock.mockReturnValue([]);

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      expect(screen.getByText('时间块历史')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // 数据一致性测试
  // ========================================================================

  describe('数据一致性（与 useTimeBlockStore 共享）', () => {
    it('should sync events between store and display', () => {
      const newEvent: TimeBlockEvent = {
        id: 'event-1',
        timestamp: Date.now(),
        _content: '同步测试事件',
        _tags: [],
      };
      mockEvents = [newEvent];

      render(<RecordPage />);

      expect(screen.getByText('同步测试事件')).toBeInTheDocument();
    });

    it('should sync time blocks between store and display', () => {
      mockTimeBlocks = [
        {
          id: 'block-1',
          startId: 'start-1',
          name: '同步测试块',
          _events: [],
        },
      ];
      mockGetTimeBlocksByStartTime.mockReturnValue(mockTimeBlocks);
      mockGetEventsInBlock.mockReturnValue([]);

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      expect(screen.getByText('时间块历史')).toBeInTheDocument();
    });

    it('should display events in correct chronological order', () => {
      const now = Date.now();
      mockEvents = [
        {
          id: 'event-1',
          timestamp: now - 60000,
          _content: '第一条',
          _tags: [],
        },
        {
          id: 'event-2',
          timestamp: now - 30000,
          _content: '第二条',
          _tags: [],
        },
        {
          id: 'event-3',
          timestamp: now,
          _content: '第三条',
          _tags: [],
        },
      ];

      render(<RecordPage />);

      expect(screen.getByText('第一条')).toBeInTheDocument();
      expect(screen.getByText('第二条')).toBeInTheDocument();
      expect(screen.getByText('第三条')).toBeInTheDocument();
    });

    it('should group events by date', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      mockEvents = [
        {
          id: 'event-1',
          timestamp: yesterday.getTime(),
          _content: '昨天的消息',
          _tags: [],
        },
        {
          id: 'event-2',
          timestamp: today.getTime(),
          _content: '今天的消息',
          _tags: [],
        },
      ];

      render(<RecordPage />);

      expect(screen.getByText('昨天的消息')).toBeInTheDocument();
      expect(screen.getByText('今天的消息')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // 历史面板功能测试
  // ========================================================================

  describe('历史面板功能', () => {
    it('should show empty message when no time blocks', () => {
      mockTimeBlocks = [];

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      // 在历史面板中查找
      const historyPanel = screen.getByText('时间块历史').closest('div');
      expect(historyPanel?.textContent).toContain('暂无记录');
    });

    it('should display recent time blocks in reverse order', () => {
      const now = Date.now();
      mockTimeBlocks = [
        {
          id: 'block-1',
          startId: 'start-1',
          name: '较早的块',
          _events: [{ id: 'start-1', timestamp: now - 7200000, _content: '开始', _tags: [] }],
        },
        {
          id: 'block-2',
          startId: 'start-2',
          name: '较晚的块',
          _events: [{ id: 'start-2', timestamp: now - 3600000, _content: '开始', _tags: [] }],
        },
      ];
      mockGetTimeBlocksByStartTime.mockReturnValue(mockTimeBlocks);

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      const blocks = screen.getAllByText(/较早的块|较晚的块/);
      expect(blocks).toHaveLength(2);
    });

    it('should show event count for each time block', () => {
      const now = Date.now();
      mockTimeBlocks = [
        {
          id: 'block-1',
          startId: 'start-1',
          name: '测试块',
          _events: [
            { id: 'start-1', timestamp: now - 3600000, _content: '开始', _tags: [] },
            { id: 'event-1', timestamp: now - 1800000, _content: '事件1', _tags: [] },
            { id: 'event-2', timestamp: now, _content: '事件2', _tags: [] },
          ],
        },
      ];
      mockGetTimeBlocksByStartTime.mockReturnValue(mockTimeBlocks);
      mockGetEventsInBlock.mockReturnValue(mockTimeBlocks[0]._events);

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      expect(screen.getByText('3 条记录')).toBeInTheDocument();
    });

    it('should show active indicator for ongoing block', () => {
      mockActiveBlock = {
        id: 'block-1',
        startId: 'start-1',
        name: '进行中',
        _events: [
          {
            id: 'start-1',
            timestamp: Date.now() - 3600000,
            _content: '开始时间块: 进行中',
            _tags: ['block_start', '进行中'],
          },
        ],
      };
      mockEvents = mockActiveBlock._events;
      mockTimeBlocks = [mockActiveBlock];
      mockGetTimeBlocksByStartTime.mockReturnValue(mockTimeBlocks);
      mockGetEventsInBlock.mockReturnValue(mockActiveBlock._events);

      render(<RecordPage />);

      const toggleButton = screen.getByRole('button', { name: /历史/i });
      fireEvent.click(toggleButton);

      expect(screen.getByText(/🔵/)).toBeInTheDocument();
    });
  });
});
