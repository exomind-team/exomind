/**
 * EventLog 格式定义测试
 * TDD 流程：RED - GREEN - REFACTOR
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EventLog, EventType, createEventLog } from '../../../src/lib/eventlog/format';

// 动态导入以确保模块存在
let formatModule: typeof import('../../../src/lib/eventlog/format');

beforeAll(async () => {
  formatModule = await import('../../../src/lib/eventlog/format');
});

// 测试 1: EventLog 类型包含必需字段
describe('EventLog Types', () => {
  it('should have required fields: id, type, content, device_id, timestamp', () => {
    const event = formatModule.createEventLog('device_online', 'test content', 'device-001');
    expect(event.id).toBeDefined();
    expect(event.type).toBe('device_online');
    expect(event.content).toBe('test content');
    expect(event.device_id).toBe('device-001');
    expect(event.timestamp).toBeDefined();
  });
  
  it('should generate unique id for each event', () => {
    const event1 = formatModule.createEventLog('device_online', 'test', 'device-001');
    const event2 = formatModule.createEventLog('device_online', 'test', 'device-001');
    expect(event1.id).not.toBe(event2.id);
  });
  
  it('should accept valid event types', () => {
    const types: EventType[] = [
      'device_register',
      'device_online',
      'device_offline',
      'message_send',
      'message_delivered',
      'message_failed'
    ];
    types.forEach(type => {
      const event = formatModule.createEventLog(type, 'test', 'device-001');
      expect(event.type).toBe(type);
    });
  });
});

// 测试 2: 消息序列化/反序列化
describe('EventLog Serialization', () => {
  it('should serialize to JSON correctly', () => {
    const event = formatModule.createEventLog('message_send', 'hello world', 'device-001');
    const json = JSON.stringify(event);
    expect(json).toContain('"id":"' + event.id + '"');
    expect(json).toContain('"type":"message_send"');
    expect(json).toContain('"content":"hello world"');
    expect(json).toContain('"device_id":"device-001"');
    expect(json).toContain('"timestamp":"' + event.timestamp + '"');
  });
  
  it('should deserialize from JSON correctly', () => {
    const event = formatModule.createEventLog('message_delivered', 'delivered msg', 'device-002');
    const json = JSON.stringify(event);
    const parsed: EventLog = JSON.parse(json);
    expect(parsed.id).toBe(event.id);
    expect(parsed.type).toBe(event.type);
    expect(parsed.content).toBe(event.content);
    expect(parsed.device_id).toBe(event.device_id);
    expect(parsed.timestamp).toBe(event.timestamp);
  });
});

// 边界条件测试
describe('EventLog Edge Cases', () => {
  it('should handle empty content', () => {
    const event = createEventLog('message_send', '', 'device-001');
    expect(event.content).toBe('');
  });
  
  it('should handle special characters in content', () => {
    const special = 'Hello\n\t\r"\/[]{}';
    const event = createEventLog('message_send', special, 'device-001');
    expect(event.content).toBe(special);
  });
});
