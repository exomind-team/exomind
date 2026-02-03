/**
 * Message Sender - 消息发送器
 * 负责消息发送、状态跟踪和重试机制
 */

export interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
  retryCount?: number;
}

export interface SendOptions {
  content: string;
  from: string;
  to: string;
}

export interface WsClient {
  send: (msg: unknown) => Promise<void>;
  on: (event: string, cb: (data: unknown) => void) => void;
}

export interface EventLog {
  append: (event: string, data: unknown) => void;
}

export interface MessageSenderOptions {
  wsClient: WsClient;
  eventLog: EventLog;
}

export class MessageSender {
  private wsClient: WsClient;
  private eventLog: EventLog;
  private pendingMessages: Map<string, Message> = new Map();
  private maxRetries = 3;

  constructor(options: MessageSenderOptions) {
    this.wsClient = options.wsClient;
    this.eventLog = options.eventLog;
  }

  /**
   * Generate UUID for message ID
   */
  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Send a message with retry mechanism
   */
  async send(options: SendOptions): Promise<Message> {
    const message: Message = {
      id: this.generateId(),
      content: options.content,
      from: options.from,
      to: options.to,
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.pendingMessages.set(message.id, message);
    
    // Send with retry
    await this.sendWithRetry(message);

    return message;
  }

  /**
   * Send message with exponential backoff retry
   */
  private async sendWithRetry(message: Message): Promise<void> {
    const payload = {
      type: 'message',
      id: message.id,
      content: message.content,
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
    };

    try {
      await this.wsClient.send(payload);
      message.status = 'sent';
      
      this.eventLog.append('message_sent', {
        id: message.id,
        content: message.content,
        from: message.from,
        to: message.to,
      });

      // Register delivery confirmation handler
      this.wsClient.on('delivery', (data: unknown) => {
        const deliveryData = data as { messageId: string };
        if (deliveryData.messageId === message.id) {
          message.status = 'delivered';
        }
      });

    } catch (error) {
      message.retryCount = (message.retryCount || 0) + 1;
      
      if (message.retryCount! < this.maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, message.retryCount! - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.sendWithRetry(message);
      } else {
        message.status = 'failed';
      }
    }
  }

  /**
   * Resend a failed message
   */
  async resend(messageId: string): Promise<Message | null> {
    const message = this.pendingMessages.get(messageId);
    if (!message || message.status === 'delivered') {
      return null;
    }

    message.status = 'pending';
    message.retryCount = 0;
    await this.sendWithRetry(message);

    return message;
  }

  /**
   * Get pending message status
   */
  getStatus(messageId: string): Message | undefined {
    return this.pendingMessages.get(messageId);
  }
}
