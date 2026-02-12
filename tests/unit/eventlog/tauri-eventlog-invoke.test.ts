import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EventData } from '@/lib/types/event';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('Tauri EventLog invoke contract', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();

    if (typeof window !== 'undefined') {
      (window as { __TAURI__?: unknown }).__TAURI__ = { __VERSION__: '2.0.0' };
    } else {
      (globalThis as { window: { __TAURI__?: unknown } }).window = { __TAURI__: { __VERSION__: '2.0.0' } };
    }
  });

  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('invokes eventlog_append/list/get from adapter', async () => {
    const sample: EventData = {
      id: 'evt-1',
      timestamp: 1700000000000,
      content: 'hello tauri eventlog',
      tags: ['note'],
    };

    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case 'eventlog_append':
          return Promise.resolve();
        case 'eventlog_list':
          return Promise.resolve([sample]);
        case 'eventlog_get':
          return Promise.resolve(sample);
        default:
          return Promise.resolve(null);
      }
    });

    const { TauriEventLogStorageAdapter } = await import('@/lib/adapters/tauri-eventlog-storage');
    const adapter = new TauriEventLogStorageAdapter('user-a');

    await adapter.appendEvent(sample);
    const listed = await adapter.listEvents();
    const one = await adapter.getEvent(sample.id);

    expect(mockInvoke).toHaveBeenCalledWith('eventlog_append', { userId: 'user-a', event: sample });
    expect(mockInvoke).toHaveBeenCalledWith('eventlog_list', { userId: 'user-a' });
    expect(mockInvoke).toHaveBeenCalledWith('eventlog_get', { userId: 'user-a', id: sample.id });
    expect(listed).toHaveLength(1);
    expect(one?.id).toBe(sample.id);
  });

  it('registers eventlog commands in tauri backend', () => {
    const commandModule = readFileSync('src-tauri/src/commands/mod.rs', 'utf-8');
    const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf-8');

    expect(commandModule).toContain('eventlog_commands');
    expect(tauriLib).toContain('eventlog_append');
    expect(tauriLib).toContain('eventlog_list');
    expect(tauriLib).toContain('eventlog_get');
  });
});
