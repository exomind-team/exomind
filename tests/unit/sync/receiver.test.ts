import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

// Types for the receiver
interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  type: string;
  timestamp: number;
}

interface WsServer {
  broadcast: (msg: unknown) => void;
  send: (clientId: string, msg: unknown) => void;
}

interface EventLog {
  append: (event: string, data: unknown) => void;
}

interface UiCallback {
  (type: string, data: unknown): void;
}

interface MessageReceiverOptions {
  wsServer: WsServer;
  eventLog: EventLog;
  uiCallback: UiCallback;
}

// Mock implementations
const createMockWsServer = () => ({
  broadcast: vi.fn(),
  send: vi.fn(),
});

const createMockEventLog = () => ({
  append: vi.fn(),
});

const createMockUiCallback = () => vi.fn();

const createTestMessage = (): Message => ({
  id: 'test-msg-123',
  content: 'Hello from test',
  from: 'device-001',
  to: 'device-002',
  type: 'message',
  timestamp: Date.now(),
});

describe('Message Receiver', () => {
  let mockWsServer: ReturnType<typeof createMockWsServer>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;
  let mockUiCallback: ReturnType<typeof createMockUiCallback>;
  let MessageReceiver: new (options: MessageReceiverOptions) => {
    onMessage: (message: Message) => Promise<void>;
    onDeliveryConfirmation: (data: unknown) => void;
  };

  beforeAll(async () => {
    const module = await import('../../../src/lib/sync/receiver');
    MessageReceiver = module.MessageReceiver;
  });

  beforeEach(() => {
    mockWsServer = createMockWsServer();
    mockEventLog = createMockEventLog();
    mockUiCallback = createMockUiCallback();
  });

  it('should receive and store message', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg = createTestMessage();
    await receiver.onMessage(msg);

    expect(mockEventLog.append).toHaveBeenCalledWith(
      'message_received',
      expect.objectContaining({
        id: msg.id,
        content: msg.content,
      })
    );
  });

  it('should send delivery confirmation', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg = createTestMessage();
    await receiver.onMessage(msg);

    expect(mockWsServer.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'deliver',
        messageId: msg.id,
        to: msg.from,
      })
    );
  });

  it('should call uiCallback on message received', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg = createTestMessage();
    await receiver.onMessage(msg);

    expect(mockUiCallback).toHaveBeenCalledWith(
      'new_message',
      expect.objectContaining({
        id: msg.id,
        content: msg.content,
      })
    );
  });

  it('should deduplicate messages', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg = createTestMessage();
    
    // First message
    await receiver.onMessage(msg);
    
    // Duplicate message (same ID)
    await receiver.onMessage(msg);

    // Should only log and broadcast once
    expect(mockEventLog.append).toHaveBeenCalledTimes(1);
    expect(mockWsServer.broadcast).toHaveBeenCalledTimes(1);
  });

  it('should handle messages from different senders', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg1 = { ...createTestMessage(), id: 'msg-1', from: 'device-001' };
    const msg2 = { ...createTestMessage(), id: 'msg-2', from: 'device-003' };

    await receiver.onMessage(msg1);
    await receiver.onMessage(msg2);

    expect(mockEventLog.append).toHaveBeenCalledTimes(2);
    expect(mockWsServer.broadcast).toHaveBeenCalledTimes(2);
  });

  it('should include timestamp in delivery confirmation', async () => {
    const receiver = new MessageReceiver({
      wsServer: mockWsServer,
      eventLog: mockEventLog,
      uiCallback: mockUiCallback,
    });

    const msg = createTestMessage();
    await receiver.onMessage(msg);

    const broadcastCall = mockWsServer.broadcast.mock.calls[0][0];
    expect(broadcastCall).toHaveProperty('timestamp');
    expect(typeof broadcastCall.timestamp).toBe('number');
  });
});
