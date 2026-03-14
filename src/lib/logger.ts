import { info, warn, error, debug, trace, attachLogger } from '@tauri-apps/plugin-log'

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: Date
}

export type LogListener = (entry: LogEntry) => void

const LOG_LEVEL_MAP: Record<number, LogLevel> = {
  1: 'TRACE',
  2: 'DEBUG',
  3: 'INFO',
  4: 'WARN',
  5: 'ERROR',
}

let detachFn: (() => void) | null = null
const listeners = new Set<LogListener>()

export async function startLogStream(): Promise<() => void> {
  if (detachFn) return detachFn

  detachFn = await attachLogger(({ level, message }) => {
    const entry: LogEntry = {
      level: LOG_LEVEL_MAP[level] ?? 'INFO',
      message,
      timestamp: new Date(),
    }
    for (const listener of listeners) {
      listener(entry)
    }
  })

  return detachFn
}

export function stopLogStream() {
  if (detachFn) {
    detachFn()
    detachFn = null
  }
}

export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Re-export for frontend code to send logs to the unified log file
export { info, warn, error, debug, trace }
