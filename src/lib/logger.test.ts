import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  trace: vi.fn().mockResolvedValue(undefined),
  attachLogger: vi.fn().mockResolvedValue(() => {}),
}));

import { log, addLogListener, setConsoleMinLevel, type LogEntry } from '@/lib/logger';

describe('unified logger（统一日志双写）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConsoleMinLevel('INFO');
  });

  it('log.info writes to both console and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.info('hello world');

    expect(consoleSpy).toHaveBeenCalledWith('[INFO]', 'hello world');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
    expect(entries[0].message).toBe('hello world');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.warn writes to console.warn and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.warn('warning msg');

    expect(consoleSpy).toHaveBeenCalledWith('[WARN]', 'warning msg');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('WARN');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.error writes to console.error and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.error('error msg');

    expect(consoleSpy).toHaveBeenCalledWith('[ERROR]', 'error msg');
    expect(entries[0].level).toBe('ERROR');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.debug skips console by default but writes to listeners', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.debug('debug msg');

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('DEBUG');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.debug writes to console when consoleMinLevel is DEBUG', () => {
    setConsoleMinLevel('DEBUG');
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.debug('debug msg');

    expect(consoleSpy).toHaveBeenCalledWith('[DEBUG]', 'debug msg');
    expect(entries[0].level).toBe('DEBUG');

    unsub();
    consoleSpy.mockRestore();
  });

  it('listener unsubscribe stops receiving entries', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.info('before');
    unsub();
    log.info('after');

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('before');
  });
});
