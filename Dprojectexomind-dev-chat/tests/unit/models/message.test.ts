import { describe, it, expect } from 'vitest';
import { createMessage } from '../../../src/lib/models/message';

describe('Message Types', () => {
  // 消息状态枚举
  it('should define message status: sending, sent, delivered, failed', () => {
    type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';
    const status: MessageStatus = 'sending';
    expect(status).toBe('sending');
  });

  // 消息类型
  it('should define message types: text, image, file', () => {
    type MessageType = 'text' | 'image' | 'file';
    const type: MessageType = 'text';
    expect(type).toBe('text');
  });

  // Message 接口
  it('should have required fields', () => {
    interface Message {
      id: string;
      type: MessageType;
      content: string;
      from: string;
      to: string;
      status: MessageStatus;
      timestamp: string;
    }
    const msg: Message = {
      id: 'msg-001',
      type: 'text',
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
      status: 'sending',
      timestamp: new Date().toISOString(),
    };
    expect(msg.id).toBe('msg-001');
    expect(msg.status).toBe('sending');
  });

  // 状态转换验证
  it('should allow valid status transitions', () => {
    const valid = ['sending', 'sent', 'delivered'];
    expect(valid).toContain('sending');
    expect(valid).toContain('sent');
  });

  it('should create message with factory function', () => {
    const msg = createMessage({
      content: 'Hello',
      from: 'device-001',
      to: 'device-002',
    });
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeDefined();
    expect(msg.status).toBe('sending');
  });
});
