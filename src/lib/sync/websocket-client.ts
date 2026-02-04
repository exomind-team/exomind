import { invoke } from '@tauri-apps/api/core';

export interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
}

export class WebSocketService {
  private connected = false;
  private messageHandlers: ((msg: SyncMessage) => void)[] = [];

  async connect(url: string): Promise<void> {
    const result = await invoke<string>('ws_connect', { url });
    if (result === 'connected') {
      this.connected = true;
    }
  }

  async disconnect(): Promise<void> {
    await invoke('ws_disconnect');
    this.connected = false;
  }

  async send(message: SyncMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('WebSocket not connected');
    }
    await invoke('ws_send', { message: JSON.stringify(message) });
  }

  onMessage(handler: (msg: SyncMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const wsService = new WebSocketService();
