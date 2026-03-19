import { Clock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb'
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop'
import { getEventLogService, getTaskService, getTimeBlockService } from '@/lib/services'
import type { Event, TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'
import { TASKS_LAST_PATH_KEY } from './task-route-memory'
import {
  buildTaskTimelineModel,
  type TaskTimelineEntry,
  type TaskTimelineModel,
  type TimelineRange,
} from './task-timeline-model'

const STATUS_COLORS = {
  pending: {
    bg: '#D6D3D1',
    darkBg: '#57534E',
    label: '待办',
  },
  in_progress: {
    bg: '#22C55E',
    darkBg: '#16A34A',
    label: '进行中',
  },
  suspended: {
    bg: '#FACC15',
    darkBg: '#CA8A04',
    label: '挂起',
  },
  completed: {
    border: '#C75B3A',
    label: '完成',
  },
  cancelled: {
    border: '#A8A29E',
    label: '取消',
  },
} as const

function formatDateInputValue(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRangeLabel(range: TimelineRange): string {
  if (range === 'today') return '今日'
  if (range === '3d') return '3 天'
  if (range === '7d') return '7 天'
  return `${formatDateInputValue(range.start)} ~ ${formatDateInputValue(range.end)}`
}

function readUrlParams(search: string): {
  range: TimelineRange
  selectedTaskId: string | null
  showPending: boolean
} {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(normalizedSearch)
  const rangeText = params.get('range') ?? 'today'
  const selectedTaskId = params.get('task')?.trim() || null
  const showPending = params.get('pending') === '1'

  let range: TimelineRange = 'today'
  if (rangeText === 'today' || rangeText === '3d' || rangeText === '7d') {
    range = rangeText
  } else if (rangeText.includes('~')) {
    const [startText, endText] = rangeText.split('~')
    const start = new Date(startText).getTime()
    const end = new Date(endText).getTime()
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      range = { start, end }
    }
  }

  return { range, selectedTaskId, showPending }
}

function serializeRange(range: TimelineRange): string {
  if (typeof range === 'string') {
    return range
  }
  return `${formatDateInputValue(range.start)}~${formatDateInputValue(range.end)}`
}

function buildTimelineSearch(range: TimelineRange, selectedTaskId: string | null, showPending: boolean): Record<string, string> {
  const search: Record<string, string> = {
    range: serializeRange(range),
  }

  if (selectedTaskId) {
    search.task = selectedTaskId
  }
  if (showPending) {
    search.pending = '1'
  }

  return search
}

function toQueryString(search: Record<string, string>): string {
  return new URLSearchParams(search).toString()
}

function resolveInputRange(range: TimelineRange, fallbackNow: number): { start: string; end: string } {
  if (typeof range === 'object') {
    return {
      start: formatDateInputValue(range.start),
      end: formatDateInputValue(range.end),
    }
  }

  const end = formatDateInputValue(fallbackNow)
  if (range === '3d') {
    return {
      start: formatDateInputValue(fallbackNow - 2 * 86_400_000),
      end,
    }
  }
  if (range === '7d') {
    return {
      start: formatDateInputValue(fallbackNow - 6 * 86_400_000),
      end,
    }
  }
  return {
    start: formatDateInputValue(fallbackNow),
    end,
  }
}

function resolveEntryAnchorTime(entry: TaskTimelineEntry): number {
  return entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? 0
}

function TimelineAxis({
  timeRange,
  isHorizontal,
}: {
  timeRange: { start: number; end: number }
  isHorizontal: boolean
}) {
  const duration = timeRange.end - timeRange.start
  const hourMs = 3_600_000
  const dayMs = 86_400_000
  const step = duration > 3 * dayMs ? dayMs : hourMs
  const ticks: Array<{ position: number; label: string }> = []

  if (duration <= 0) {
    return null
  }

  let current = Math.ceil(timeRange.start / step) * step
  while (current <= timeRange.end) {
    const position = ((current - timeRange.start) / duration) * 100
    const date = new Date(current)
    const label = step === dayMs
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${String(date.getHours()).padStart(2, '0')}:00`
    ticks.push({ position, label })
    current += step
  }

  return (
    <div
      data-testid="timeline-axis"
      className={isHorizontal
        ? 'relative h-8 border-b border-[#E7E5E4] dark:border-[#292524]'
        : 'relative w-14 shrink-0 border-r border-[#E7E5E4] dark:border-[#292524]'
      }
    >
      {ticks.map((tick) => (
        <div
          key={`${tick.label}-${tick.position}`}
          className="absolute text-[10px] text-[#78716C] dark:text-[#A8A29E]"
          style={isHorizontal ? { left: `${tick.position}%`, top: 4 } : { top: `${tick.position}%`, left: 4 }}
        >
          <span className={isHorizontal ? '-translate-x-1/2' : '-translate-y-1/2'}>{tick.label}</span>
        </div>
      ))}
    </div>
  )
}

function TimelineSwimLane({
  model,
  isHorizontal,
  selectedTaskId,
  onSelectTask,
}: {
  model: TaskTimelineModel
  isHorizontal: boolean
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
}) {
  const duration = model.timeRange.end - model.timeRange.start
  if (duration <= 0) {
    return null
  }

  const toPercent = (timestamp: number): number => {
    const percent = ((timestamp - model.timeRange.start) / duration) * 100
    return Math.max(0, Math.min(100, percent))
  }

  if (model.lanes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#D6D3D1] bg-white/70 px-4 py-8 text-center text-sm text-[#78716C] dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#A8A29E]">
        当前范围内还没有可展示的任务时间线。
      </div>
    )
  }

  if (isHorizontal) {
    return (
      <div className="min-w-[900px]">
        <TimelineAxis timeRange={model.timeRange} isHorizontal={true} />
        <div className="space-y-3 pt-3">
          {model.lanes.map((lane, laneIndex) => (
            <div key={`lane-${laneIndex}`} className="relative h-16 rounded-2xl border border-[#E7E5E4] bg-white/80 dark:border-[#292524] dark:bg-[#1C1917]">
              <span className="absolute left-3 top-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#A8A29E]">
                Lane {laneIndex + 1}
              </span>
              {lane.entries.map((entry) => {
                const anchorTime = resolveEntryAnchorTime(entry)
                const anchorPosition = toPercent(anchorTime)
                const isSelected = selectedTaskId === entry.taskId

                return (
                  <div key={entry.taskId}>
                    <button
                      type="button"
                      onClick={() => onSelectTask(entry.taskId)}
                      className={`absolute top-7 max-w-[220px] -translate-x-1/2 truncate rounded-full border px-2 py-0.5 text-[10px] ${
                        isSelected
                          ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                          : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#3F3F46] dark:bg-[#292524] dark:text-[#D6D3D1]'
                      }`}
                      style={{ left: `${anchorPosition}%` }}
                    >
                      {entry.taskTitle}
                    </button>
                    {entry.segments.map((segment, index) => {
                      const start = toPercent(segment.startTime)
                      const end = toPercent(segment.endTime)
                      const width = Math.max(end - start, 0.8)
                      const colors = STATUS_COLORS[segment.status]

                      return (
                        <button
                          key={`${entry.taskId}-${segment.startTime}-${index}`}
                          type="button"
                          data-testid={`timeline-segment-${entry.taskId}-${index}`}
                          title={`${entry.taskTitle} · ${colors.label}${segment.inferred ? '（推导）' : ''}`}
                          onClick={() => onSelectTask(entry.taskId)}
                          className={`absolute top-11 h-3 rounded-full ${segment.inferred ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-[#C75B3A]/40' : ''}`}
                          style={{
                            left: `${start}%`,
                            width: `${width}%`,
                            backgroundColor: colors.bg,
                          }}
                        />
                      )
                    })}
                    {entry.terminalMarker ? (
                      <button
                        type="button"
                        data-testid={`timeline-terminal-${entry.taskId}`}
                        title={`${entry.taskTitle} · ${STATUS_COLORS[entry.terminalMarker.status].label}${entry.terminalMarker.inferred ? '（推导）' : ''}`}
                        onClick={() => onSelectTask(entry.taskId)}
                        className={`absolute top-9 h-7 w-[3px] rounded-full ${isSelected ? 'shadow-[0_0_0_2px_rgba(199,91,58,0.24)]' : ''}`}
                        style={{
                          left: `${toPercent(entry.terminalMarker.timestamp)}%`,
                          backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border,
                        }}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[520px]">
      <TimelineAxis timeRange={model.timeRange} isHorizontal={false} />
      <div className="flex min-w-[420px] flex-1 gap-3 pl-3">
        {model.lanes.map((lane, laneIndex) => (
          <div key={`lane-${laneIndex}`} className="relative min-h-[520px] w-24 rounded-2xl border border-[#E7E5E4] bg-white/80 dark:border-[#292524] dark:bg-[#1C1917]">
            <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#A8A29E]">
              Lane {laneIndex + 1}
            </span>
            {lane.entries.map((entry) => {
              const anchorTime = resolveEntryAnchorTime(entry)
              const anchorPosition = toPercent(anchorTime)
              const isSelected = selectedTaskId === entry.taskId

              return (
                <div key={entry.taskId}>
                  <button
                    type="button"
                    onClick={() => onSelectTask(entry.taskId)}
                    className={`absolute left-1 right-1 -translate-y-1/2 rounded-xl border px-1 py-1 text-[10px] leading-4 ${
                      isSelected
                        ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                        : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#3F3F46] dark:bg-[#292524] dark:text-[#D6D3D1]'
                    }`}
                    style={{ top: `${anchorPosition}%` }}
                  >
                    {entry.taskTitle}
                  </button>
                  {entry.segments.map((segment, index) => {
                    const start = toPercent(segment.startTime)
                    const end = toPercent(segment.endTime)
                    const height = Math.max(end - start, 1.2)
                    const colors = STATUS_COLORS[segment.status]

                    return (
                      <button
                        key={`${entry.taskId}-${segment.startTime}-${index}`}
                        type="button"
                        data-testid={`timeline-segment-${entry.taskId}-${index}`}
                        title={`${entry.taskTitle} · ${colors.label}${segment.inferred ? '（推导）' : ''}`}
                        onClick={() => onSelectTask(entry.taskId)}
                        className={`absolute left-1/2 w-3 -translate-x-1/2 rounded-full ${segment.inferred ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-[#C75B3A]/40' : ''}`}
                        style={{
                          top: `${start}%`,
                          height: `${height}%`,
                          backgroundColor: colors.darkBg,
                        }}
                      />
                    )
                  })}
                  {entry.terminalMarker ? (
                    <button
                      type="button"
                      data-testid={`timeline-terminal-${entry.taskId}`}
                      title={`${entry.taskTitle} · ${STATUS_COLORS[entry.terminalMarker.status].label}${entry.terminalMarker.inferred ? '（推导）' : ''}`}
                      onClick={() => onSelectTask(entry.taskId)}
                      className={`absolute left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full ${isSelected ? 'shadow-[0_0_0_2px_rgba(199,91,58,0.24)]' : ''}`}
                      style={{
                        top: `${toPercent(entry.terminalMarker.timestamp)}%`,
                        backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border,
                      }}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineDetailPanel({
  entry,
  onClose,
  onOpenDetail,
}: {
  entry: TaskTimelineEntry
  onClose: () => void
  onOpenDetail: () => void
}) {
  return (
    <section data-testid="timeline-detail-panel" className="border-t border-[#E7E5E4] bg-white px-5 py-4 dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{entry.taskTitle}</h2>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">当前状态：{entry.currentStatus}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[#78716C] dark:text-[#A8A29E]">
          关闭
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {entry.segments.map((segment) => (
          <div key={`${segment.startTime}-${segment.endTime}-${segment.status}`} className="flex items-center gap-2 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: STATUS_COLORS[segment.status].bg,
                opacity: segment.inferred ? 0.6 : 1,
              }}
            />
            <span>{STATUS_COLORS[segment.status].label}</span>
            <span>{formatClock(segment.startTime)} - {formatClock(segment.endTime)}</span>
            {segment.inferred ? <span className="text-[#A8A29E]">推导</span> : null}
          </div>
        ))}
        {entry.terminalMarker ? (
          <div className="flex items-center gap-2 text-xs text-[#57534E] dark:text-[#D6D3D1]">
            <span
              className="h-3 w-[3px] rounded-full"
              style={{ backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border }}
            />
            <span>{STATUS_COLORS[entry.terminalMarker.status].label}</span>
            <span>{formatClock(entry.terminalMarker.timestamp)}</span>
            {entry.terminalMarker.inferred ? <span className="text-[#A8A29E]">推导</span> : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenDetail}
        className="mt-4 rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs font-medium text-[#57534E] transition-colors hover:bg-[#FAF7F5] dark:border-[#3F3F46] dark:text-[#D6D3D1] dark:hover:bg-[#292524]"
      >
        打开任务详情
      </button>
    </section>
  )
}

export function TaskTimelinePage() {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const location = useLocation()
  const now = Date.now()
  const urlState = useMemo(() => readUrlParams(location.searchStr ?? ''), [location.searchStr])
  const initialCustomRange = useMemo(() => resolveInputRange(urlState.range, now), [now, urlState.range])

  const [tasks, setTasks] = useState<TaskNode[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [range, setRange] = useState<TimelineRange>(urlState.range)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(urlState.selectedTaskId)
  const [showPending, setShowPending] = useState(urlState.showPending)
  const [customRangeOpen, setCustomRangeOpen] = useState(typeof urlState.range === 'object')
  const [customStart, setCustomStart] = useState(initialCustomRange.start)
  const [customEnd, setCustomEnd] = useState(initialCustomRange.end)

  useEffect(() => {
    sessionStorage.setItem(TASKS_LAST_PATH_KEY, '/tasks/timeline')
  }, [])

  useEffect(() => {
    setRange(urlState.range)
    setSelectedTaskId(urlState.selectedTaskId)
    setShowPending(urlState.showPending)
    setCustomRangeOpen(typeof urlState.range === 'object')
    const nextInputRange = resolveInputRange(urlState.range, Date.now())
    setCustomStart(nextInputRange.start)
    setCustomEnd(nextInputRange.end)
  }, [urlState.range, urlState.selectedTaskId, urlState.showPending])

  useEffect(() => {
    const nextSearch = buildTimelineSearch(range, selectedTaskId, showPending)
    const nextQuery = toQueryString(nextSearch)
    const currentQuery = (location.searchStr ?? '').replace(/^\?/, '')
    if (nextQuery === currentQuery) {
      return
    }

    void navigate({
      to: '/tasks/timeline',
      search: nextSearch,
      replace: true,
    })
  }, [location.searchStr, navigate, range, selectedTaskId, showPending])

  useEffect(() => {
    let disposed = false
    const taskService = getTaskService()
    const eventLogService = getEventLogService()
    const timeBlockService = getTimeBlockService()

    const load = async () => {
      const [taskList, eventList, blockList] = await Promise.all([
        taskService.listTasks(true),
        eventLogService.loadEvents(),
        timeBlockService.loadTimeBlocks(),
      ])

      if (disposed) {
        return
      }

      setTasks(taskList)
      setEvents(eventList)
      setTimeBlocks(blockList)
    }

    void load()

    const unsubscribeTasks = taskService.onTaskChange(() => {
      void load()
    })
    const unsubscribeEvents = eventLogService.onEvent(() => {
      void load()
    })
    const unsubscribeBlocks = timeBlockService.onBlockChange(() => {
      void load()
    })

    return () => {
      disposed = true
      unsubscribeTasks()
      unsubscribeEvents()
      unsubscribeBlocks()
    }
  }, [])

  const model = useMemo(() => (
    buildTaskTimelineModel(tasks, events, timeBlocks, range, { showPending })
  ), [events, range, showPending, tasks, timeBlocks])

  const selectedEntry = model.entries.find((entry) => entry.taskId === selectedTaskId) ?? null

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }
    if (!model.entries.some((entry) => entry.taskId === selectedTaskId)) {
      setSelectedTaskId(null)
    }
  }, [model.entries, selectedTaskId])

  const handleApplyCustomRange = () => {
    const start = new Date(customStart).getTime()
    const endDate = new Date(customEnd)
    if (!Number.isFinite(start) || !Number.isFinite(endDate.getTime())) {
      return
    }
    endDate.setHours(23, 59, 59, 999)
    const end = endDate.getTime()
    if (end < start) {
      return
    }
    setRange({ start, end })
    setCustomRangeOpen(false)
  }

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-timeline-page">
      <header className="border-b border-[#F0ECE8] px-5 py-4 dark:border-[#292524] md:px-8 lg:px-10">
        <TaskBreadcrumb segments={[{ label: '任务', to: '/tasks' }]} current={{ label: '时间线', icon: Clock }} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务时间线</h1>
            <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
              以任务为主语回看状态推进、终态收口与时间块痕迹。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['today', '3d', '7d'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setRange(option)
                  setCustomRangeOpen(false)
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === option
                    ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                    : 'border-[#E7E3E0] bg-white text-[#57534E] hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917] dark:text-[#A8A29E]'
                }`}
              >
                {option === 'today' ? '今日' : option}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomRangeOpen((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                typeof range === 'object' || customRangeOpen
                  ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                  : 'border-[#E7E3E0] bg-white text-[#57534E] hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917] dark:text-[#A8A29E]'
              }`}
            >
              自定义
            </button>
            <button
              type="button"
              onClick={() => setShowPending((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                showPending
                  ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                  : 'border-[#E7E3E0] bg-white text-[#57534E] hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917] dark:text-[#A8A29E]'
              }`}
            >
              {showPending ? '隐藏待办段' : '显示待办段'}
            </button>
          </div>
        </div>

        {customRangeOpen ? (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-[#E7E5E4] bg-white/80 p-3 dark:border-[#292524] dark:bg-[#1C1917]">
            <label className="flex flex-col gap-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              开始日期
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="rounded-xl border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:text-[#FAFAF9]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              结束日期
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="rounded-xl border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] dark:border-[#3F3F46] dark:text-[#FAFAF9]"
              />
            </label>
            <button
              type="button"
              onClick={handleApplyCustomRange}
              className="rounded-full bg-[#C75B3A] px-4 py-2 text-xs font-semibold text-white"
            >
              应用范围
            </button>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">范围：{formatRangeLabel(range)}</span>
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">任务：{model.entries.length}</span>
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">泳道：{model.lanes.length}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 md:px-8 lg:px-10">
        <TimelineSwimLane
          model={model}
          isHorizontal={isDesktop}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      </div>

      {selectedEntry ? (
        <TimelineDetailPanel
          entry={selectedEntry}
          onClose={() => setSelectedTaskId(null)}
          onOpenDetail={() => {
            void navigate({
              to: '/tasks/$taskId',
              params: { taskId: selectedEntry.taskId },
              search: { from: 'timeline' },
            })
          }}
        />
      ) : null}
    </div>
  )
}
