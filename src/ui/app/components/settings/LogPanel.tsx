import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { addLogListener, startLogStream, stopLogStream, type LogEntry, type LogLevel } from '@/lib/logger'

const LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const LEVEL_ORDER: Record<LogLevel, number> = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 }
const LEVEL_COLORS: Record<LogLevel, string> = {
  TRACE: 'text-muted-foreground',
  DEBUG: 'text-blue-500',
  INFO: 'text-green-500',
  WARN: 'text-yellow-500',
  ERROR: 'text-red-500',
}
const MAX_ENTRIES = 500

export function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO')
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScroll = useRef(true)

  useEffect(() => {
    startLogStream()
    const removeListener = addLogListener((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    })
    return () => {
      removeListener()
      stopLogStream()
    }
  }, [])

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  const filtered = entries.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[minLevel])

  return (
    <div className="flex flex-col h-[60vh] gap-2">
      <div className="flex items-center gap-1 flex-shrink-0">
        {LEVELS.map((level) => (
          <Button
            key={level}
            variant={minLevel === level ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMinLevel(level)}
            aria-label={level}
            aria-pressed={minLevel === level}
          >
            {level.toLowerCase()}
          </Button>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setEntries([])} aria-label="清除">
          清除
        </Button>
      </div>
      <div
        className="flex-1 overflow-y-auto font-mono text-xs bg-muted/50 rounded-md p-2 space-y-0.5"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">暂无日志</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-muted-foreground whitespace-nowrap">
                {entry.timestamp.toLocaleTimeString()}
              </span>
              <span className={`font-semibold w-12 text-right ${LEVEL_COLORS[entry.level]}`}>
                {entry.level}
              </span>
              <span className="break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
