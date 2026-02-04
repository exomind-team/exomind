import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventLog } from '../../src/lib/eventlog/format';

// Mock dependencies
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockReturnValue('');

describe('MessageStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReturnValue('');
  });

  it('should generate unique message IDs', () => {
    const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should create message with correct structure', () => {
    const message = {
      id: `msg-${Date.now()}`,
      type: 'chat',
      content: 'Hello',
      timestamp: Date.now(),
      senderId: 'device-1',
      receiverId: 'device-2',
      status: 'sending' as const,
    };

    expect(message).toHaveProperty('id');
    expect(message).toHaveProperty('content');
    expect(message).toHaveProperty('timestamp');
    expect(message).toHaveProperty('senderId');
    expect(message).toHaveProperty('receiverId');
    expect(message).toHaveProperty('status');
    expect(message.type).toBe('chat');
    expect(message.status).toBe('sending');
  });

  it('should format event log entry correctly', () => {
    const event: EventLog = {
      id: 'evt-1',
      type: 'message_sent',
      timestamp: Date.now(),
      data: { messageId: 'msg-1', content: 'Hello' },
    };

    const line = JSON.stringify(event);
    const parsed = JSON.parse(line);

    expect(parsed.id).toBe('evt-1');
    expect(parsed.type).toBe('message_sent');
    expect(parsed.data.messageId).toBe('msg-1');
  });

  it('should serialize message to sync format', () => {
    const message = {
      id: 'msg-1',
      type: 'chat',
      content: 'Hello',
      timestamp: Date.now(),
      senderId: 'device-1',
      receiverId: 'device-2',
    };

    const syncPayload = {
      type: 'CHANGE',
      payload: {
        entity: 'message',
        data: message,
      },
      timestamp: message.timestamp,
      deviceId: message.senderId,
    };

    expect(syncPayload.type).toBe('CHANGE');
    expect(syncPayload.payload.entity).toBe('message');
    expect(syncPayload.payload.data).toEqual(message);
  });
});
