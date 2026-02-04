/**
 * Message Storage Service
 * Handles local message storage and sync with backend
 */

import { invoke } from '@tauri-apps/api/core';
import type { EventLog } from '../eventlog/format';

// Message types
export interface ChatMessage {
  id: string;
  type: 'chat';
  content: string;
  timestamp: number;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
}

export interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
}

// FileSystem interface for Tauri
interface FileSystem {
  writeFile: (path: string, data: string) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
}

// Message Storage class
export class MessageStorage {
  private deviceId: string = '';
  private messageHandlers: ((msg: ChatMessage) => void)[] = [];

  constructor(private fs: FileSystem, private storagePath: string = '.exomind') {
    this.initDeviceId();
  }

  private async initDeviceId(): Promise<void> {
    try {
      this.deviceId = await invoke('get_device_id') as string;
    } catch {
      // Fallback: generate ID
      this.deviceId = `device-${Date.now()}`;
    }
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    const event: EventLog = {
      id: `evt-${message.id}`,
      type: 'message_send',
      content: message.content,
      device_id: message.senderId,
      timestamp: new Date(message.timestamp).toISOString(),
      metadata: {
        messageId: message.id,
        receiverId: message.receiverId,
        status: message.status,
      },
    };

    const line = JSON.stringify(event) + '\n';
    await this.fs.writeFile(`${this.storagePath}/messages.jsonl`, line);
  }

  async getMessages(limit: number = 50): Promise<ChatMessage[]> {
    try {
      const content = await this.fs.readTextFile(`${this.storagePath}/messages.jsonl`);
      if (!content) return [];

      const events = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as EventLog)
        .filter(evt => evt.type === 'message_send')
        .slice(-limit);

      return events.map(evt => ({
        id: evt.metadata?.messageId as string || evt.id,
        type: 'chat' as const,
        content: evt.content,
        timestamp: new Date(evt.timestamp).getTime(),
        senderId: evt.device_id,
        receiverId: (evt.metadata?.receiverId as string) || '',
        status: (evt.metadata?.status as ChatMessage['status']) || 'sent',
      }));
    } catch {
      return [];
    }
  }

  async getMessagesWithDevice(deviceId: string): Promise<ChatMessage[]> {
    const allMessages = await this.getMessages(100);
    return allMessages.filter(
      msg => msg.senderId === deviceId || msg.receiverId === deviceId
    );
  }

  generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  createOutgoingMessage(
    content: string,
    receiverId: string
  ): ChatMessage {
    return {
      id: this.generateMessageId(),
      type: 'chat',
      content,
      timestamp: Date.now(),
      senderId: this.deviceId,
      receiverId,
      status: 'sending',
    };
  }

  createSyncMessage(message: ChatMessage): SyncMessage {
    return {
      type: 'CHANGE',
      payload: {
        entity: 'message',
        data: message,
      },
      timestamp: message.timestamp,
      deviceId: this.deviceId,
    };
  }

  parseSyncMessage(raw: unknown): SyncMessage {
    return raw as SyncMessage;
  }

  onMessage(handler: (msg: ChatMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  handleIncomingMessage(syncMsg: SyncMessage): void {
    if (syncMsg.type !== 'CHANGE' || !syncMsg.payload) return;

    const payload = syncMsg.payload as { entity: string; data: unknown };
    if (payload.entity !== 'message') return;

    const message = payload.data as ChatMessage;
    if (message.senderId !== this.deviceId) {
      // Only notify for messages from others
      this.messageHandlers.forEach(handler => handler(message));
    }
  }

  getDeviceId(): string {
    return this.deviceId;
  }
}

// Singleton instance
let storageInstance: MessageStorage | null = null;

export function getMessageStorage(fs: FileSystem): MessageStorage {
  if (!storageInstance) {
    storageInstance = new MessageStorage(fs);
  }
  return storageInstance;
}
