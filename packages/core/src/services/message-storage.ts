/**
 * Message Storage Service
 * Handles local message storage and sync with backend
 * Supports both Tauri (file system) and Web (localStorage) modes
 */

// Environment type declaration for Tauri
interface TauriWindow {
  core?: Record<string, unknown>;
}

declare global {
  interface Window {
    __TAURI__?: TauriWindow;
  }
}

// Environment detection - wrap in typeof check to avoid SSR errors
const isTauri = typeof window !== 'undefined' && window.__TAURI__ !== undefined;

// Only log in browser/tauri environment, not during SSR/build
if (typeof window !== 'undefined') {
  console.log('[MessageStorage] Environment detection:', {
    isTauri,
    hasWindow: typeof window !== 'undefined',
    hasTauri: window.__TAURI__ !== undefined,
  });
}

// Dynamic import for Tauri API (CommonJS module)
let invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> | undefined;

async function getInvokeFn() {
  if (!invoke && isTauri) {
    try {
      const tauri = await import('@tauri-apps/api/core');
      invoke = tauri.invoke;
    } catch {
      console.warn('[MessageStorage] Failed to load Tauri API');
    }
  }
  return invoke;
}

// Web Storage Adapter (localStorage fallback)
const webStorage = {
  async writeFile(path: string, data: string): Promise<void> {
    try {
      localStorage.setItem(`exomind:${path}`, data);
      console.log('[MessageStorage] Web write success:', path, 'data length:', data.length);
    } catch (error) {
      console.error('[MessageStorage] Web write failed:', path, error);
      throw error;
    }
  },

  async readTextFile(path: string): Promise<string> {
    try {
      const result = localStorage.getItem(`exomind:${path}`);
      console.log('[MessageStorage] Web read:', path, 'found:', !!result);
      return result || '';
    } catch (error) {
      console.error('[MessageStorage] Web read failed:', path, error);
      return '';
    }
  },

  async appendFile(path: string, data: string): Promise<void> {
    try {
      const key = `exomind:${path}`;
      const existing = localStorage.getItem(key) || '';
      const newContent = existing + data;
      localStorage.setItem(key, newContent);
      console.log('[MessageStorage] Web append success:', path, 'appended:', data.length, 'total:', newContent.length);
    } catch (error) {
      console.error('[MessageStorage] Web append failed:', path, error);
      throw error;
    }
  },
};

// Tauri Storage Adapter
const tauriStorage = {
  async writeFile(path: string, data: string): Promise<void> {
    const fn = await getInvokeFn();
    if (fn) {
      await fn('write_file', { path, content: data });
    } else {
      throw new Error('Tauri API not available');
    }
  },

  async readTextFile(path: string): Promise<string> {
    const fn = await getInvokeFn();
    if (fn) {
      return await fn('read_file', { path }) as string;
    }
    throw new Error('Tauri API not available');
  },

  async appendFile(path: string, data: string): Promise<void> {
    const fn = await getInvokeFn();
    if (fn) {
      await fn('append_file', { path, content: data });
    } else {
      throw new Error('Tauri API not available');
    }
  },
};

// Use appropriate storage based on environment
const fs = isTauri ? tauriStorage : webStorage;
if (typeof window !== 'undefined') {
  console.log('[MessageStorage] Using storage:', isTauri ? 'Tauri' : 'Web (localStorage)');
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

// Event log type for message storage (compatible format)
export interface MessageEventLog {
  id: string;
  type: 'message_send';
  content: string;
  device_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Message Storage class
export class MessageStorage {
  private deviceId: string = '';
  private messageHandlers: ((msg: ChatMessage) => void)[] = [];

  constructor(private storagePath: string = '.exomind') {
    this.initDeviceId();
  }

  private async initDeviceId(): Promise<void> {
    console.log('[MessageStorage] Initializing device ID...');
    if (isTauri) {
      try {
        const fn = await getInvokeFn();
        if (fn) {
          this.deviceId = await fn('get_device_id') as string;
          console.log('[MessageStorage] Tauri device ID:', this.deviceId);
        }
      } catch {
        this.deviceId = `device-${Date.now()}`;
        console.log('[MessageStorage] Generated fallback device ID:', this.deviceId);
      }
    } else {
      // Web: try to get from localStorage
      const stored = localStorage.getItem('exomind:deviceId');
      this.deviceId = stored || `device-${Date.now()}`;
      localStorage.setItem('exomind:deviceId', this.deviceId);
      console.log('[MessageStorage] Web device ID:', this.deviceId, 'from storage:', !!stored);
    }
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    const event: MessageEventLog = {
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
    const storagePath = `${this.storagePath}/messages.jsonl`;

    console.log('[MessageStorage] Saving message:', message.id, 'to:', storagePath);

    try {
      // 使用 append_file 追加写入，永不覆盖
      await fs.appendFile(storagePath, line);
      console.log('[MessageStorage] Message saved successfully:', message.id);
    } catch (error) {
      console.error('[MessageStorage] Failed to save message:', message.id, error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  async getMessages(limit: number = 50): Promise<ChatMessage[]> {
    const storagePath = `${this.storagePath}/messages.jsonl`;
    console.log('[MessageStorage] Loading messages from:', storagePath, 'limit:', limit);

    try {
      const content = await fs.readTextFile(storagePath);
      console.log('[MessageStorage] Raw content length:', content.length);

      if (!content) {
        console.log('[MessageStorage] No content found, returning empty array');
        return [];
      }

      const events = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as MessageEventLog)
        .filter(evt => evt.type === 'message_send')
        .slice(-limit);

      console.log('[MessageStorage] Parsed', events.length, 'messages');

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
      console.error('[MessageStorage] Failed to load messages:', error);
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

export function getMessageStorage(): MessageStorage {
  if (!storageInstance) {
    storageInstance = new MessageStorage();
  }
  return storageInstance;
}
