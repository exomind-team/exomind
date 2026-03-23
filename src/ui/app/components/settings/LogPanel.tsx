import { useEffect, useRef, useState, useCallback } from 'react'
import { addLogListener, getLogHistory, startLogStream, type LogEntry, type LogLevel } from '@/lib/logger'

const LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const LEVEL_ORDER: Record<LogLevel, number> = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 }
const LEVEL_COLORS: Record<LogLevel, string> = {
  TRACE: 'text-[#A8A29E]',
  DEBUG: 'text-[#60A5FA]',
  INFO: 'text-[#34D399]',
  WARN: 'text-[#FBBF24]',
  ERROR: 'text-[#F87171]',
}
const MAX_ENTRIES = 500

function LevelFilterButton({
  level,
  active,
  onClick,
}: {
  level: LogLevel
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={level}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-[#1C1917] text-[#FAFAF9] dark:bg-[#FAFAF9] dark:text-[#1C1917]'
          : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
      }`}
    >
      {level.toLowerCase()}
    </button>
  )
}

export function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO')
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScroll = useRef(true)

  useEffect(() => {
    // 回放应用启动以来的历史日志
    const past = getLogHistory()
    if (past.length > 0) {
      setEntries(past.slice(-MAX_ENTRIES))
    }

    startLogStream()
    const removeListener = addLogListener((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    })
    return () => {
      removeListener()
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
    <div className="flex flex-col h-[60vh] gap-3">
      <div className="flex items-center gap-1 flex-shrink-0">
        {LEVELS.map((level) => (
          <LevelFilterButton
            key={level}
            level={level}
            active={minLevel === level}
            onClick={() => setMinLevel(level)}
          />
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setEntries([])}
          aria-label="清除"
          className="rounded-lg px-3 py-1.5 text-xs text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524] transition-colors"
        >
          清除
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto font-mono text-xs rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] p-3 space-y-0.5 dark:border-[#292524] dark:bg-[#0C0A09]"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="text-[#A8A29E] text-center py-8">暂无日志</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-[#A8A29E] whitespace-nowrap">
                {entry.timestamp.toLocaleTimeString()}
              </span>
              <span className={`font-semibold w-12 text-right ${LEVEL_COLORS[entry.level]}`}>
                {entry.level}
              </span>
              <span className="text-[#1C1917] dark:text-[#FAFAF9] break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
