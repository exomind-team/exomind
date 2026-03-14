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

const LEVEL_ORDER: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

const MAX_HISTORY = 1000;

/** console 输出最低级别：默认 INFO，DEBUG/TRACE 只写入 LogPanel + Tauri 日志 */
let consoleMinLevel: LogLevel = 'INFO';

let detachFn: (() => void) | null = null;
const listeners = new Set<LogListener>();
const history: LogEntry[] = [];

function emit(level: LogLevel, message: string): void {
  const entry: LogEntry = { level, message, timestamp: new Date() };

  // 1) Browser console (only if level >= consoleMinLevel)
  if (LEVEL_ORDER[level] >= LEVEL_ORDER[consoleMinLevel]) {
    const method = CONSOLE_METHOD[level];
    // eslint-disable-next-line no-console
    (console[method] as (...args: unknown[]) => void)(`[${level}]`, message);
  }

  // 2) Ring buffer (survives before LogPanel opens)
  history.push(entry);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

  // 3) In-memory listeners (LogPanel)
  for (const listener of listeners) {
    listener(entry);
  }
}

/** 设置 console 输出的最低级别（默认 INFO） */
export function setConsoleMinLevel(level: LogLevel): void {
  consoleMinLevel = level;
}

/** 获取自应用启动以来的全部历史日志 */
export function getLogHistory(): readonly LogEntry[] {
  return history;
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
