import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, SyncMessage } from '../../src/lib/sync/message-storage';
import { MessageStorage } from '../../src/lib/sync/message-storage';

const storageData: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => storageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageData[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete storageData[key];
  }),
  clear: vi.fn(() => {
    Object.keys(storageData).forEach((key) => delete storageData[key]);
  }),
  key: vi.fn(),
  length: 0,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      __TAURI__: undefined,
      location: { hostname: 'localhost' },
      localStorage: mockLocalStorage,
    },
    writable: true,
    configurable: true,
  });
}

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    type: 'chat',
    content: 'hello',
    timestamp: Date.now(),
    senderId: 'device-a',
    receiverId: 'device-b',
    status: 'sending',
    ...overrides,
  };
}

describe('message storage sync reliability', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  it('createSyncMessage should include idempotent fields and enter pending queue', () => {
    const storage = new MessageStorage('.exomind-sync-test');
    const message = createMessage({ id: 'msg-idempotent-1' });

    const syncMessage = storage.createSyncMessage(message);
    const payload = syncMessage.payload as Record<string, unknown>;

    expect(syncMessage.type).toBe('CHANGE');
    expect(payload.event_id).toBeTypeOf('string');
    expect(payload.client_nonce).toBeTypeOf('string');
    expect(payload.data).toMatchObject({ id: 'msg-idempotent-1' });
    expect(storage.getUnackedSyncMessages()).toHaveLength(1);
  });

  it('should mark ACK state and clear pending queue after ack message', () => {
    const storage = new MessageStorage('.exomind-sync-test');
    const message = createMessage({ id: 'msg-ack-1' });
    storage.createSyncMessage(message);

    const ackMessage: SyncMessage = {
      type: 'ACK',
      payload: { messageId: 'msg-ack-1' },
      timestamp: Date.now(),
      deviceId: 'device-b',
    };

    storage.handleIncomingMessage(ackMessage);

    expect(storage.isMessageAcked('msg-ack-1')).toBe(true);
    expect(storage.getUnackedSyncMessages()).toHaveLength(0);
  });

  it('should drop duplicate CHANGE packets with same event_id/client_nonce', () => {
    const storage = new MessageStorage('.exomind-sync-test');
    const handler = vi.fn();
    storage.onMessage(handler);

    const duplicateChange: SyncMessage = {
      type: 'CHANGE',
      payload: {
        entity: 'message',
        event_id: 'evt-dup-1',
        client_nonce: 'nonce-dup-1',
        data: createMessage({
          id: 'msg-dup-1',
          senderId: 'device-remote',
          receiverId: storage.getDeviceId(),
        }),
      },
      timestamp: Date.now(),
      deviceId: 'device-remote',
    };

    storage.handleIncomingMessage(duplicateChange);
    storage.handleIncomingMessage(duplicateChange);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
