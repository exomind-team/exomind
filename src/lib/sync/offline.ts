/**
 * Offline Queue - 离线队列
 * 负责离线消息存储和在线时自动发送
 */

export interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  timestamp: number;
}

export interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface OfflineQueueOptions {
  storage: Storage;
  onOnline?: () => void;
}

export class OfflineQueue {
  private storage: Storage;
  private onOnlineCallback?: () => void;
  private messages: Message[] = [];
  private isOnlineFlag: boolean = true;
  private readonly STORAGE_KEY = 'offline_queue';

  constructor(options: OfflineQueueOptions) {
    this.storage = options.storage;
    this.onOnlineCallback = options.onOnline;

    // Load persisted messages
    this.loadFromStorage();
  }

  /**
   * Load messages from persistent storage
   */
  private loadFromStorage(): void {
    try {
      const stored = this.storage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.messages = JSON.parse(stored);
      }
    } catch (error) {
      // Invalid storage data, start fresh
      this.messages = [];
    }
  }

  /**
   * Persist messages to storage
   */
  private saveToStorage(): void {
    try {
      this.storage.setItem(this.STORAGE_KEY, JSON.stringify(this.messages));
    } catch (error) {
      // Storage failed, messages will be lost on reload
    }
  }

  /**
   * Push a message to the queue
   */
  async push(message: Message): Promise<void> {
    if (this.isOnlineFlag) {
      // Online: send immediately, don't queue
      return;
    }

    // Offline: add to queue and persist
    this.messages.push(message);
    this.saveToStorage();
  }

  /**
   * Pop the oldest message from the queue
   */
  async pop(): Promise<Message | null> {
    if (this.messages.length === 0) {
      return null;
    }

    const message = this.messages.shift()!;
    this.saveToStorage();
    return message;
  }

  /**
   * Get the number of queued messages
   */
  length(): number {
    return this.messages.length;
  }

  /**
   * Set online status
   */
  setOnline(online: boolean): void {
    const wasOffline = !this.isOnlineFlag;
    this.isOnlineFlag = online;

    // Trigger callback when coming back online
    if (wasOffline && online && this.onOnlineCallback) {
      this.onOnlineCallback();
    }
  }

  /**
   * Get current online status
   */
  isOnline(): boolean {
    return this.isOnlineFlag;
  }

  /**
   * Clear all queued messages
   */
  clear(): void {
    this.messages = [];
    this.saveToStorage();
  }

  /**
   * Get all queued messages (for inspection)
   */
  getAll(): Message[] {
    return [...this.messages];
  }
}
