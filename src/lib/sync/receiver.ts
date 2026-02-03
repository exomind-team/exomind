/**
 * Message Receiver - 消息接收器
 * 负责消息接收、去重和交付确认
 */

export interface Message {
  id: string;
  content: string;
  from: string;
  to: string;
  type: string;
  timestamp: number;
}

export interface WsServer {
  broadcast: (msg: unknown) => void;
  send: (clientId: string, msg: unknown) => void;
}

export interface EventLog {
  append: (event: string, data: unknown) => void;
}

export interface UiCallback {
  (type: string, data: unknown): void;
}

export interface MessageReceiverOptions {
  wsServer: WsServer;
  eventLog: EventLog;
  uiCallback: UiCallback;
}

export class MessageReceiver {
  private wsServer: WsServer;
  private eventLog: EventLog;
  private uiCallback: UiCallback;
  private receivedMessages: Set<string> = new Set();

  constructor(options: MessageReceiverOptions) {
    this.wsServer = options.wsServer;
    this.eventLog = options.eventLog;
    this.uiCallback = options.uiCallback;
  }

  /**
   * Handle incoming message
   */
  async onMessage(message: Message): Promise<void> {
    // Deduplication: skip if already processed
    if (this.receivedMessages.has(message.id)) {
      return;
    }

    // Mark as received
    this.receivedMessages.add(message.id);

    // Log the received message
    this.eventLog.append('message_received', {
      id: message.id,
      content: message.content,
      from: message.from,
      to: message.to,
    });

    // Trigger UI update
    this.uiCallback('new_message', {
      id: message.id,
      content: message.content,
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
    });

    // Send delivery confirmation
    this.sendDeliveryConfirmation(message);
  }

  /**
   * Send delivery confirmation back to sender
   */
  private sendDeliveryConfirmation(message: Message): void {
    const confirmation = {
      type: 'deliver',
      messageId: message.id,
      from: message.to,
      to: message.from,
      timestamp: Date.now(),
    };

    this.wsServer.broadcast(confirmation);
  }

  /**
   * Handle delivery confirmation for sent messages
   */
  onDeliveryConfirmation(data: unknown): void {
    const confirmation = data as { messageId: string };
    
    this.eventLog.append('delivery_confirmed', {
      messageId: confirmation.messageId,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear received message cache (for memory management)
   */
  clearCache(maxSize = 1000): void {
    if (this.receivedMessages.size > maxSize) {
      // Keep only the most recent messages
      const messages = Array.from(this.receivedMessages);
      const toRemove = messages.slice(0, messages.length - maxSize);
      toRemove.forEach(id => this.receivedMessages.delete(id));
    }
  }
}
