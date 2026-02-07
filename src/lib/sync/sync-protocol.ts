import { SyncMessage } from './websocket-client';

export class SyncProtocol {
  private deviceId: string;

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
  }

  private getOrCreateDeviceId(): string {
    let id: string | null = null;
    try {
      id = localStorage.getItem('deviceId');
    } catch {
      // localStorage may not be available in some environments
    }
    if (!id) {
      id = crypto.randomUUID();
      try {
        localStorage.setItem('deviceId', id);
      } catch {
        // ignore if localStorage is not available
      }
    }
    return id;
  }

  createAuthMessage(token: string): SyncMessage {
    return {
      type: 'AUTH',
      payload: { token },
      timestamp: Date.now(),
      deviceId: this.deviceId,
    };
  }

  createSyncRequest(lastSync: number): SyncMessage {
    return {
      type: 'SYNC_REQUEST',
      payload: { lastSync },
      timestamp: Date.now(),
      deviceId: this.deviceId,
    };
  }

  createChangeMessage(entity: string, data: unknown): SyncMessage {
    return {
      type: 'CHANGE',
      payload: { entity, data },
      timestamp: Date.now(),
      deviceId: this.deviceId,
    };
  }

  parseMessage(data: string): SyncMessage {
    return JSON.parse(data) as SyncMessage;
  }
}

export const syncProtocol = new SyncProtocol();
