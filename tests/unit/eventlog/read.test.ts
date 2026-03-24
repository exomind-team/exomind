import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createReader } from '../../../src/lib/eventlog/reader';
import { EventLog } from '../../../src/lib/eventlog/format';

describe('EventLog Reader', () => {
  // Mock 文件系统
  const mockReadFile = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should read all events from file', () => {
    const reader = createReader({
      path: '/test/eventlog.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    const content = `{"id":"1","type":"message_send","content":"Hello","device_id":"d1","timestamp":"2026-02-03T10:00:00Z"}
{"id":"2","type":"message_delivered","content":"","device_id":"d2","timestamp":"2026-02-03T10:00:01Z"}`;
    
    mockReadFile.mockReturnValue(content);
    const events = reader.readAll();
    
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
  });
  
  it('should return empty array for empty file', () => {
    const reader = createReader({
      path: '/test/empty.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    mockReadFile.mockReturnValue('');
    const events = reader.readAll();
    
    expect(events).toHaveLength(0);
  });
  
  it('should handle pagination with limit', () => {
    const reader = createReader({
      path: '/test/eventlog.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    const content = `{"id":"1","type":"message_send","content":"Hello","device_id":"d1","timestamp":"2026-02-03T10:00:00Z"}
{"id":"2","type":"message_delivered","content":"","device_id":"d2","timestamp":"2026-02-03T10:00:01Z"}
{"id":"3","type":"message_send","content":"World","device_id":"d1","timestamp":"2026-02-03T10:00:02Z"}`;
    
    mockReadFile.mockReturnValue(content);
    const events = reader.readWithLimit(2);
    
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
  });
  
  it('should handle pagination with offset', () => {
    const reader = createReader({
      path: '/test/eventlog.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    const content = `{"id":"1","type":"message_send","content":"Hello","device_id":"d1","timestamp":"2026-02-03T10:00:00Z"}
{"id":"2","type":"message_delivered","content":"","device_id":"d2","timestamp":"2026-02-03T10:00:01Z"}
{"id":"3","type":"message_send","content":"World","device_id":"d1","timestamp":"2026-02-03T10:00:02Z"}`;
    
    mockReadFile.mockReturnValue(content);
    const events = reader.readWithOffset(1);
    
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('2');
    expect(events[1].id).toBe('3');
  });
  
  it('should support reverse order', () => {
    const reader = createReader({
      path: '/test/eventlog.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    const content = `{"id":"1","type":"message_send","content":"Hello","device_id":"d1","timestamp":"2026-02-03T10:00:00Z"}
{"id":"2","type":"message_delivered","content":"","device_id":"d2","timestamp":"2026-02-03T10:00:01Z"}
{"id":"3","type":"message_send","content":"World","device_id":"d1","timestamp":"2026-02-03T10:00:02Z"}`;
    
    mockReadFile.mockReturnValue(content);
    const events = reader.readReverse();
    
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe('3');
    expect(events[2].id).toBe('1');
  });
  
  it('should filter by event type', () => {
    const reader = createReader({
      path: '/test/eventlog.jsonl',
      fs: { readFile: mockReadFile }
    });
    
    const content = `{"id":"1","type":"message_send","content":"Hello","device_id":"d1","timestamp":"2026-02-03T10:00:00Z"}
{"id":"2","type":"message_delivered","content":"","device_id":"d2","timestamp":"2026-02-03T10:00:01Z"}
{"id":"3","type":"message_send","content":"World","device_id":"d1","timestamp":"2026-02-03T10:00:02Z"}`;
    
    mockReadFile.mockReturnValue(content);
    const events = reader.readByType('message_send');
    
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('message_send');
    expect(events[1].type).toBe('message_send');
  });
});
