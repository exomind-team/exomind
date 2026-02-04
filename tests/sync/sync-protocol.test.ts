import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncProtocol } from '../../src/lib/sync/sync-protocol';

// Setup Storage mock for Node environment
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  clear: vi.fn(),
  removeItem: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('SyncProtocol', () => {
  let protocol: SyncProtocol;

  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue(null);
    localStorageMock.setItem.mockImplementation(() => {});
    vi.spyOn(localStorageMock, 'getItem').mockReturnValue(null);
    vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {});
    protocol = new SyncProtocol();
  });

  it('should create auth message', () => {
    const msg = protocol.createAuthMessage('token123');
    expect(msg.type).toBe('AUTH');
    expect(msg.payload).toEqual({ token: 'token123' });
    expect(msg.deviceId).toBeDefined();
  });

  it('should create sync request message', () => {
    const msg = protocol.createSyncRequest(1000);
    expect(msg.type).toBe('SYNC_REQUEST');
    expect(msg.payload).toEqual({ lastSync: 1000 });
  });

  it('should create change message', () => {
    const data = { name: 'Test' };
    const msg = protocol.createChangeMessage('user', data);
    expect(msg.type).toBe('CHANGE');
    expect(msg.payload).toEqual({ entity: 'user', data });
  });

  it('should parse message', () => {
    const original = protocol.createAuthMessage('token');
    const parsed = protocol.parseMessage(JSON.stringify(original));
    expect(parsed.type).toBe(original.type);
    expect(parsed.deviceId).toBe(original.deviceId);
  });
});
