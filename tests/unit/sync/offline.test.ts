import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

// Types for the offline queue
interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  timestamp: number;
}

interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface OfflineQueueOptions {
  storage: Storage;
  onOnline?: () => void;
}

// Mock implementations
const createMockStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      Object.keys(store).forEach(k => delete store[k]);
    },
    getStore: () => store,
  };
};

const createTestMessage = (): Message => ({
  id: 'test-msg-123',
  content: 'Hello from test',
  from: 'device-001',
  to: 'device-002',
  timestamp: Date.now(),
});

describe('Offline Queue', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;
  let onOnlineCallback: ReturnType<typeof vi.fn>;
  let OfflineQueue: new (options: OfflineQueueOptions) => {
    push: (message: Message) => Promise<void>;
    pop: () => Promise<Message | null>;
    length: () => number;
    setOnline: (online: boolean) => void;
    isOnline: () => boolean;
    clear: () => void;
  };

  beforeAll(async () => {
    const module = await import('../../../src/lib/sync/offline');
    OfflineQueue = module.OfflineQueue;
  });

  beforeEach(() => {
    mockStorage = createMockStorage();
    onOnlineCallback = vi.fn();
  });

  it('should store message when offline', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(false);
    await queue.push(createTestMessage());

    expect(queue.length()).toBe(1);
  });

  it('should not store message when online', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(true);
    await queue.push(createTestMessage());

    expect(queue.length()).toBe(0);
  });

  it('should auto-send when back online', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
      onOnline: onOnlineCallback,
    });

    const msg = createTestMessage();
    
    queue.setOnline(false);
    await queue.push(msg);
    expect(queue.length()).toBe(1);

    queue.setOnline(true);
    
    // The onOnline callback should be triggered
    expect(onOnlineCallback).toHaveBeenCalled();
  });

  it('should return messages in FIFO order', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(false);
    
    const msg1 = { ...createTestMessage(), id: 'msg-1', content: 'First' };
    const msg2 = { ...createTestMessage(), id: 'msg-2', content: 'Second' };
    const msg3 = { ...createTestMessage(), id: 'msg-3', content: 'Third' };

    await queue.push(msg1);
    await queue.push(msg2);
    await queue.push(msg3);

    const popped1 = await queue.pop();
    const popped2 = await queue.pop();
    const popped3 = await queue.pop();

    expect(popped1?.id).toBe('msg-1');
    expect(popped2?.id).toBe('msg-2');
    expect(popped3?.id).toBe('msg-3');
  });

  it('should persist messages to storage', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(false);
    const msg = createTestMessage();
    await queue.push(msg);

    expect(mockStorage.setItem).toHaveBeenCalledWith(
      'offline_queue',
      expect.any(String)
    );
  });

  it('should clear all messages', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(false);
    await queue.push(createTestMessage());
    await queue.push(createTestMessage());
    expect(queue.length()).toBe(2);

    queue.clear();
    expect(queue.length()).toBe(0);
  });

  it('should report correct online status', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    expect(queue.isOnline()).toBe(true); // Default

    queue.setOnline(false);
    expect(queue.isOnline()).toBe(false);

    queue.setOnline(true);
    expect(queue.isOnline()).toBe(true);
  });

  it('should handle empty queue pop', async () => {
    const queue = new OfflineQueue({
      storage: mockStorage,
    });

    queue.setOnline(false);
    const msg = await queue.pop();
    expect(msg).toBeNull();
  });
});
