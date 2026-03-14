/**
 * Message Storage Service
 * Handles local message storage and sync with backend
 * Supports both Tauri (file system) and Web (localStorage) modes
 */

import { invoke } from '@tauri-apps/api/core';
import type { EventLog } from '../eventlog/format';
import { log } from '@/lib/logger';

// Detect environment more reliably - wrap in typeof check to avoid SSR errors
const isTauri = typeof window !== 'undefined' && window.__TAURI__ !== undefined;

// Only log in browser/tauri environment, not during SSR/build
if (typeof window !== 'undefined') {
  log.info(`[MessageStorage] Environment detection: ${JSON.stringify({
    isTauri,
    hasWindow: typeof window !== 'undefined',
    hasTauri: window.__TAURI__ !== undefined,
  })}`);
}

// Web Storage Adapter (localStorage fallback)
const webStorage = {
  async writeFile(path: string, data: string): Promise<void> {
    try {
      localStorage.setItem(`exomind:${path}`, data);
      log.info(`[MessageStorage] Web write success: ${path} data length: ${data.length}`);
    } catch (error) {
      log.error(`[MessageStorage] Web write failed: ${path} ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  },

  async readTextFile(path: string): Promise<string> {
    try {
      const result = localStorage.getItem(`exomind:${path}`);
      log.info(`[MessageStorage] Web read: ${path} found: ${!!result}`);
      return result || '';
    } catch (error) {
      log.error(`[MessageStorage] Web read failed: ${path} ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  },

  async appendFile(path: string, data: string): Promise<void> {
    try {
      const key = `exomind:${path}`;
      const existing = localStorage.getItem(key) || '';
      const newContent = existing + data;
      localStorage.setItem(key, newContent);
      log.info(`[MessageStorage] Web append success: ${path} appended: ${data.length} total: ${newContent.length}`);
    } catch (error) {
      log.error(`[MessageStorage] Web append failed: ${path} ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  },
};

// Tauri Storage Adapter
const tauriStorage = {
  async writeFile(path: string, data: string): Promise<void> {
    await invoke('write_file', { path, content: data });
  },

  async readTextFile(path: string): Promise<string> {
    return await invoke('read_file', { path }) as string;
  },

  async appendFile(path: string, data: string): Promise<void> {
    await invoke('append_file', { path, content: data });
  },
};

// Use appropriate storage based on environment
const fs = isTauri ? tauriStorage : webStorage;
if (typeof window !== 'undefined') {
  log.info(`[MessageStorage] Using storage: ${isTauri ? 'Tauri' : 'Web (localStorage)'}`);
}

// Message types
export interface ChatMessage {
  id: string;
  type: 'chat';
  content: string;
  timestamp: number;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
  direction?: 'outgoing' | 'incoming';
  deviceId?: string;
}

export interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
}

export interface SyncChangePayload {
  entity: 'message';
  data: ChatMessage;
  event_id: string;
  client_nonce: string;
}

export interface SyncAckPayload {
  messageId: string;
  event_id?: string;
  client_nonce?: string;
}

export interface SaveMessageResult {
  saved: boolean;
  deduplicated: boolean;
  messageId: string;
  eventId: string;
  clientNonce: string;
}

// Message Storage class
export class MessageStorage {
  private deviceId: string = '';
  private messageHandlers: ((msg: ChatMessage) => void)[] = [];
  private deviceIdInitPromise: Promise<void>;
  private persistedMessageKeys: Set<string> = new Set();
  private handledIncomingKeys: Set<string> = new Set();
  private pendingSyncMessages: Map<string, SyncMessage> = new Map();
  private ackedMessageIds: Set<string> = new Set();

  constructor(private storagePath: string = '.exomind') {
    this.deviceId = this.resolveInitialDeviceId();
    this.deviceIdInitPromise = this.initDeviceId();
  }

  private resolveInitialDeviceId(): string {
    const fallback = `device-${Date.now()}`;

    if (typeof localStorage === 'undefined') {
      return fallback;
    }

    const stored = localStorage.getItem('exomind:deviceId');
    if (stored) {
      return stored;
    }

    if (!isTauri) {
      localStorage.setItem('exomind:deviceId', fallback);
      return fallback;
    }

    return fallback;
  }

  private async initDeviceId(): Promise<void> {
    log.info('[MessageStorage] Initializing device ID...');
    if (isTauri) {
      try {
        this.deviceId = await invoke('get_device_id') as string;
        localStorage.setItem('exomind:deviceId', this.deviceId);
        log.info(`[MessageStorage] Tauri device ID: ${this.deviceId}`);
      } catch {
        const stored = localStorage.getItem('exomind:deviceId');
        this.deviceId = stored || this.deviceId || `device-${Date.now()}`;
        localStorage.setItem('exomind:deviceId', this.deviceId);
        log.info(`[MessageStorage] Fallback device ID: ${this.deviceId}`);
      }
    } else {
      // Web: try to get from localStorage
      const stored = localStorage.getItem('exomind:deviceId');
      this.deviceId = stored || `device-${Date.now()}`;
      localStorage.setItem('exomind:deviceId', this.deviceId);
      log.info(`[MessageStorage] Web device ID: ${this.deviceId} from storage: ${!!stored}`);
    }
  }

  async waitForDeviceIdReady(): Promise<void> {
    await this.deviceIdInitPromise;
  }

  private resolveEventId(message: ChatMessage): string {
    return `evt-${message.senderId}-${message.id}`;
  }

  private resolveClientNonce(message: ChatMessage): string {
    return `nonce-${message.senderId}-${message.id}`;
  }

  private resolveMessageKey(message: ChatMessage): string {
    return `${message.senderId}:${message.id}`;
  }

  private async isMessagePersisted(storagePath: string, message: ChatMessage): Promise<boolean> {
    const messageKey = this.resolveMessageKey(message);
    if (this.persistedMessageKeys.has(messageKey)) {
      return true;
    }

    const content = await fs.readTextFile(storagePath);
    if (!content) {
      return false;
    }

    const lines = content.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as EventLog;
        const storedMessageId = event.metadata?.messageId as string | undefined;
        if (storedMessageId === message.id && event.device_id === message.senderId) {
          this.persistedMessageKeys.add(messageKey);
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  async saveMessage(message: ChatMessage): Promise<SaveMessageResult> {
    const eventId = this.resolveEventId(message);
    const clientNonce = this.resolveClientNonce(message);
    const messageKey = this.resolveMessageKey(message);
    const event: EventLog = {
      id: eventId,
      type: 'message_send',
      content: message.content,
      device_id: message.senderId,
      timestamp: new Date(message.timestamp).toISOString(),
      metadata: {
        messageId: message.id,
        receiverId: message.receiverId,
        status: message.status,
        event_id: eventId,
        client_nonce: clientNonce,
      },
    };

    const line = JSON.stringify(event) + '\n';
    const storagePath = `${this.storagePath}/messages.jsonl`;

    log.info(`[MessageStorage] Saving message: ${message.id} to: ${storagePath}`);

    try {
      if (await this.isMessagePersisted(storagePath, message)) {
        log.info(`[MessageStorage] Duplicate message skipped: ${message.id}`);
        return {
          saved: false,
          deduplicated: true,
          messageId: message.id,
          eventId,
          clientNonce,
        };
      }

      // 使用 append_file 追加写入，永不覆盖
      await fs.appendFile(storagePath, line);
      this.persistedMessageKeys.add(messageKey);
      log.info(`[MessageStorage] Message saved successfully: ${message.id}`);
      return {
        saved: true,
        deduplicated: false,
        messageId: message.id,
        eventId,
        clientNonce,
      };
    } catch (error) {
      log.error(`[MessageStorage] Failed to save message: ${message.id} ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw so caller knows it failed
    }
  }

  async getMessages(limit: number = 50): Promise<ChatMessage[]> {
    const storagePath = `${this.storagePath}/messages.jsonl`;
    log.info(`[MessageStorage] Loading messages from: ${storagePath} limit: ${limit}`);

    try {
      const content = await fs.readTextFile(storagePath);
      log.info(`[MessageStorage] Raw content length: ${content.length}`);

      if (!content) {
        log.info('[MessageStorage] No content found, returning empty array');
        return [];
      }

      const events = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as EventLog)
        .filter(evt => evt.type === 'message_send')
        .slice(-limit);

      log.info(`[MessageStorage] Parsed ${events.length} messages`);

      return events.map(evt => {
        const isOutgoing = evt.device_id === this.deviceId;
        return {
          id: evt.metadata?.messageId as string || evt.id,
          type: 'chat' as const,
          content: evt.content,
          timestamp: new Date(evt.timestamp).getTime(),
          senderId: evt.device_id,
          receiverId: (evt.metadata?.receiverId as string) || '',
          status: (evt.metadata?.status as ChatMessage['status']) || 'sent',
          direction: isOutgoing ? 'outgoing' : 'incoming',
          deviceId: this.deviceId,
        };
      });
    } catch (error) {
      log.error(`[MessageStorage] Failed to load messages: ${error instanceof Error ? error.message : String(error)}`);
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
    const eventId = this.resolveEventId(message);
    const clientNonce = this.resolveClientNonce(message);
    const syncMessage: SyncMessage = {
      type: 'CHANGE',
      payload: {
        entity: 'message',
        data: message,
        event_id: eventId,
        client_nonce: clientNonce,
      },
      timestamp: message.timestamp,
      deviceId: this.deviceId,
    };

    this.ackedMessageIds.delete(message.id);
    this.pendingSyncMessages.set(message.id, syncMessage);
    return syncMessage;
  }

  createAckMessage(messageId: string, eventId?: string, clientNonce?: string): SyncMessage {
    const payload: SyncAckPayload = {
      messageId,
      event_id: eventId,
      client_nonce: clientNonce,
    };

    return {
      type: 'ACK',
      payload,
      timestamp: Date.now(),
      deviceId: this.deviceId,
    };
  }

  markMessageAcked(messageId: string): void {
    this.ackedMessageIds.add(messageId);
    this.pendingSyncMessages.delete(messageId);
  }

  isMessageAcked(messageId: string): boolean {
    return this.ackedMessageIds.has(messageId);
  }

  getUnackedSyncMessages(): SyncMessage[] {
    return Array.from(this.pendingSyncMessages.values());
  }

  parseSyncMessage(raw: unknown): SyncMessage {
    return raw as SyncMessage;
  }

  onMessage(handler: (msg: ChatMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private getIncomingDedupKey(syncMsg: SyncMessage): string | null {
    if (syncMsg.type !== 'CHANGE' || !syncMsg.payload) {
      return null;
    }

    const payload = syncMsg.payload as Partial<SyncChangePayload>;
    if (typeof payload.event_id === 'string' && payload.event_id) {
      return `event:${payload.event_id}`;
    }

    if (typeof payload.client_nonce === 'string' && payload.client_nonce) {
      return `nonce:${payload.client_nonce}`;
    }

    const message = payload.data as ChatMessage | undefined;
    if (message?.id && message?.senderId) {
      return `message:${message.senderId}:${message.id}`;
    }

    return null;
  }

  handleIncomingMessage(syncMsg: SyncMessage): void {
    if (syncMsg.type === 'ACK' && syncMsg.payload) {
      const payload = syncMsg.payload as Partial<SyncAckPayload>;
      if (typeof payload.messageId === 'string' && payload.messageId) {
        this.markMessageAcked(payload.messageId);
      }
      return;
    }

    if (syncMsg.type !== 'CHANGE' || !syncMsg.payload) return;

    const payload = syncMsg.payload as { entity: string; data: unknown };
    if (payload.entity !== 'message') return;

    const dedupKey = this.getIncomingDedupKey(syncMsg);
    if (dedupKey) {
      if (this.handledIncomingKeys.has(dedupKey)) {
        return;
      }
      this.handledIncomingKeys.add(dedupKey);
    }

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

export function getMessageStorage(): MessageStorage {
  if (!storageInstance) {
    storageInstance = new MessageStorage();
  }
  return storageInstance;
}
