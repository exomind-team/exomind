import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventLog, createEventLog, EventType } from '../../../src/lib/eventlog/format';
import { EventLogWriter, createWriter } from '../../../src/lib/eventlog/writer';

describe('EventLog Writer', () => {
  let mockWriteFile: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile = vi.fn().mockResolvedValue(undefined);
    mockReadFile = vi.fn().mockResolvedValue('');
  });
  
  it('should append event to file', async () => {
    const writer = createWriter({
      path: '/test/eventlog.jsonl',
      fs: { writeFile: mockWriteFile, readFile: mockReadFile }
    });
    
    const event = createEventLog('message_send', 'Hello', 'device-001');
    await writer.append(event);
    
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
  
  it('should append JSONL format (one JSON per line)', async () => {
    const writer = createWriter({
      path: '/test/eventlog.jsonl',
      fs: { writeFile: mockWriteFile, readFile: mockReadFile }
    });
    
    const event = createEventLog('message_send', 'Hello', 'device-001');
    await writer.append(event);
    
    const call = mockWriteFile.mock.calls[0][1];
    expect(call).toContain('"type":"message_send"');
    expect(call).toContain('"content":"Hello"');
  });
  
  it('should create file if not exists', async () => {
    const writer = createWriter({
      path: '/test/new.jsonl',
      fs: { writeFile: mockWriteFile, readFile: mockReadFile }
    });
    
    const event = createEventLog('device_register', 'New Device', 'device-new');
    await writer.append(event);
    
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
  
  it('should handle multiple events', async () => {
    const writer = createWriter({
      path: '/test/eventlog.jsonl',
      fs: { writeFile: mockWriteFile, readFile: mockReadFile }
    });
    
    for (let i = 0; i < 10; i++) {
      await writer.append(createEventLog('message_send', `Message ${i}`, 'device-001'));
    }
    
    expect(mockWriteFile).toHaveBeenCalledTimes(10);
  });
});
