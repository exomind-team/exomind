import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

// Types for the sender
interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
}

interface SendOptions {
  content: string;
  from: string;
  to: string;
}

interface WsClient {
  send: (msg: unknown) => Promise<void>;
  on: (event: string, cb: (data: unknown) => void) => void;
}

interface EventLog {
  append: (event: string, data: unknown) => void;
}

interface MessageSenderOptions {
  wsClient: WsClient;
  eventLog: EventLog;
}

// Mock implementations
const createMockWsClient = () => {
  const handlers: Record<string, ((data: unknown) => void)[]> = {};
  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
    }),
    trigger: (event: string, data: unknown) => {
      handlers[event]?.forEach(cb => cb(data));
    }
  };
};

const createMockEventLog = () => ({
  append: vi.fn(),
});

describe('Message Sender', () => {
  let mockWsClient: ReturnType<typeof createMockWsClient>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;
  let MessageSender: new (options: MessageSenderOptions) => {
    send: (options: SendOptions) => Promise<Message>;
    resend: (messageId: string) => Promise<Message>;
  };

  beforeAll(async () => {
    const module = await import('../../../src/lib/sync/sender');
    MessageSender = module.MessageSender;
  });

  beforeEach(() => {
    mockWsClient = createMockWsClient();
    mockEventLog = createMockEventLog();
  });

  it('should send message with id', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    const msg = await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    expect(msg.id).toBeDefined();
    expect(msg.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(msg.status).toBe('sent');
  });

  it('should include content in message', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    const msg = await sender.send({
      content: 'Test message',
      from: 'device-001',
      to: 'device-002',
    });

    expect(msg.content).toBe('Test message');
    expect(msg.from).toBe('device-001');
    expect(msg.to).toBe('device-002');
  });

  it('should call wsClient.send with correct payload', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    expect(mockWsClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message',
        content: 'Hello',
        from: 'device-001',
        to: 'device-002',
      })
    );
  });

  it('should log sent event', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    expect(mockEventLog.append).toHaveBeenCalledWith(
      'message_sent',
      expect.objectContaining({
        content: 'Hello',
        from: 'device-001',
        to: 'device-002',
      })
    );
  });

  it('should wait for delivery confirmation', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    const msg = await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    // Simulate delivery confirmation
    mockWsClient.trigger('delivery', { messageId: msg.id });

    // Verify handler was registered
    expect(mockWsClient.on).toHaveBeenCalledWith('delivery', expect.any(Function));
  });

  it('should retry on failure', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    // First send fails
    mockWsClient.send.mockRejectedValueOnce(new Error('Network error'));
    mockWsClient.send.mockResolvedValue(undefined);

    const msg = await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    expect(msg.status).toBe('sent');
    expect(mockWsClient.send).toHaveBeenCalledTimes(2);
  });

  it('should track retry count', async () => {
    const sender = new MessageSender({
      wsClient: mockWsClient,
      eventLog: mockEventLog,
    });

    // Fail twice, succeed on third try
    mockWsClient.send
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(undefined);

    const msg = await sender.send({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });

    expect(msg.status).toBe('sent');
    expect(mockWsClient.send).toHaveBeenCalledTimes(3);
  });
});
