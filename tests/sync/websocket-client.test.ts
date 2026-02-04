import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketService, SyncMessage } from '../../src/lib/sync/websocket-client';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('WebSocketService', () => {
  let service: WebSocketService;

  beforeEach(() => {
    service = new WebSocketService();
  });

  it('should initialize with disconnected state', () => {
    expect(service.isConnected()).toBe(false);
  });

  it('should throw error when sending without connection', async () => {
    const message: SyncMessage = {
      type: 'CHANGE',
      payload: {},
      timestamp: Date.now(),
      deviceId: 'test-device',
    };
    await expect(service.send(message)).rejects.toThrow('WebSocket not connected');
  });

  it('should register message handlers', () => {
    const handler = vi.fn();
    service.onMessage(handler);
    expect(service['messageHandlers']).toContain(handler);
  });
});
