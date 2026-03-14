import {
  info as tauriInfo,
  warn as tauriWarn,
  error as tauriError,
  debug as tauriDebug,
  trace as tauriTrace,
  attachLogger,
} from '@tauri-apps/plugin-log';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

export type LogListener = (entry: LogEntry) => void;

const LOG_LEVEL_MAP: Record<number, LogLevel> = {
  1: 'TRACE',
  2: 'DEBUG',
  3: 'INFO',
  4: 'WARN',
  5: 'ERROR',
};

const CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  TRACE: 'debug',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

let detachFn: (() => void) | null = null;
const listeners = new Set<LogListener>();

function emit(level: LogLevel, message: string): void {
  const entry: LogEntry = { level, message, timestamp: new Date() };

  // 1) Browser console
  const method = CONSOLE_METHOD[level];
  // eslint-disable-next-line no-console
  (console[method] as (...args: unknown[]) => void)(`[${level}]`, message);

  // 2) In-memory listeners (LogPanel)
  for (const listener of listeners) {
    listener(entry);
  }
}

/** 双写日志对象：同时输出到 console + LogPanel listeners */
export const log = {
  trace: (message: string) => { emit('TRACE', message); void tauriTrace(message).catch(() => {}); },
  debug: (message: string) => { emit('DEBUG', message); void tauriDebug(message).catch(() => {}); },
  info:  (message: string) => { emit('INFO',  message); void tauriInfo(message).catch(() => {}); },
  warn:  (message: string) => { emit('WARN',  message); void tauriWarn(message).catch(() => {}); },
  error: (message: string) => { emit('ERROR', message); void tauriError(message).catch(() => {}); },
};

export async function startLogStream(): Promise<() => void> {
  if (detachFn) return detachFn;

  detachFn = await attachLogger(({ level, message }) => {
    const entry: LogEntry = {
      level: LOG_LEVEL_MAP[level] ?? 'INFO',
      message,
      timestamp: new Date(),
    };
    for (const listener of listeners) {
      listener(entry);
    }
  });

  return detachFn;
}

export function stopLogStream(): void {
  if (detachFn) {
    detachFn();
    detachFn = null;
  }
}

export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 向后兼容：保留旧的直接 re-export（逐步废弃）
export const info = log.info;
export const warn = log.warn;
export const error = log.error;
export const debug = log.debug;
export const trace = log.trace;
