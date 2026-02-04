/**
 * Message Storage Service
 * Handles local message storage and sync with backend
 */

import { invoke } from '@tauri-apps/api/core';
import { EventLog, createWriter, createReader } from '../eventlog';

// Message types
export interface ChatMessage {
  id: string;
  type: 'chat';
  content: string;
  timestamp: number;
  senderId: string;
  receiverId: string;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
}

export interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
}

// FileSystem interface for Tauri
interface TauriFileSystem {
  writeFile: (path: string, data: string) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
}

// Message Storage class
export class MessageStorage {
  private writer: ReturnType<typeof createWriter> | null = null;
  private reader: ReturnType<typeof createReader> | null = null;
  private deviceId: string = '';
  private messageHandlers: ((msg: ChatMessage) => void)[] = [];

  constructor(private fs: TauriFileSystem, private storagePath: string = '.exomind') {
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

  private ensureWriter(): void {
    if (!this.writer) {
      this.writer = createWriter({
        path: `${this.storagePath}/messages.jsonl`,
        fs: {
          writeFile: async (path, data) => {
            await this.fs.writeFile(path, data);
          },
        },
      });
    }
  }

  private ensureReader(): void {
    if (!this.reader) {
      this.reader = createReader({
        path: `${this.storagePath}/messages.jsonl`,
        fs: {
          readFile: (_path, _encoding) => '', // Will be replaced with actual read
        },
      });
    }
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    this.ensureWriter();

    const event: EventLog = {
      id: `evt-${message.id}`,
      type: 'message_saved',
      timestamp: message.timestamp,
      data: message,
    };

    await this.writer!.append(event);
  }

  async getMessages(limit: number = 50): Promise<ChatMessage[]> {
    try {
      const content = await this.fs.readTextFile(`${this.storagePath}/messages.jsonl`);
      if (!content) return [];

      const events = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as EventLog)
        .filter(evt => evt.type === 'message_saved')
        .slice(-limit);

      return events.map(evt => evt.data as ChatMessage);
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

export function getMessageStorage(fs: TauriFileSystem): MessageStorage {
  if (!storageInstance) {
    storageInstance = new MessageStorage(fs);
  }
  return storageInstance;
}
