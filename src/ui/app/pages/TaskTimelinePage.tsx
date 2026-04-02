import { ChevronDown, Clock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SlidingSegmentedControl } from '@/ui/app/components/SlidingSegmentedControl'
import { TaskDomainTabs } from '@/ui/app/components/TaskDomainTabs'
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb'
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop'
import { getEventLogService, getTaskService, getTimeBlockService } from '@/lib/services'
import type { Event, TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'
import {
  getTaskTimelineLayoutMode as readPersistedLayoutMode,
  getTaskTimelineRange as readPersistedRange,
  getTaskTimelineSelectedTaskId as readPersistedSelectedTaskId,
  getTaskTimelineShowPending as readPersistedShowPending,
  serializeTaskTimelineRange as serializeRange,
  TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY,
  TASK_TIMELINE_RANGE_STORAGE_KEY,
  TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY,
  TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY,
  setTaskTimelineLayoutMode as persistTimelineLayoutMode,
  setTaskTimelineRange as persistTimelineRange,
  setTaskTimelineSelectedTaskId as persistTimelineSelectedTaskId,
  setTaskTimelineShowPending as persistTimelineShowPending,
  type TaskTimelineLayoutMode,
} from '@/config/task-timeline-preferences'
import { TASKS_LAST_PATH_KEY } from './task-route-memory'
import {
  buildTaskTimelineModel,
  type TaskTimelineEntry,
  type TimelineCustomRange,
  type TimelineCustomScaleUnit,
  type TaskTimelineModel,
  type TimelineRange,
  resolveTimeRange,
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
    border: '#3B82F6',
    label: '完成',
  },
  cancelled: {
    border: '#EF4444',
    label: '取消',
  },
} as const

const HORIZONTAL_FALLBACK_VIEWPORT_PX = 960
const VERTICAL_FALLBACK_VIEWPORT_PX = 720
const HORIZONTAL_TRACK_HEIGHT_PX = 32
const HORIZONTAL_LANE_HEIGHT_PX = HORIZONTAL_TRACK_HEIGHT_PX + 4
const HORIZONTAL_TERMINAL_HEIGHT_PX = HORIZONTAL_LANE_HEIGHT_PX
const TITLE_BUTTON_THICKNESS_PX = HORIZONTAL_TRACK_HEIGHT_PX - 8
const TITLE_EDGE_INSET_PX = (HORIZONTAL_TRACK_HEIGHT_PX - TITLE_BUTTON_THICKNESS_PX) / 2
const VERTICAL_TRACK_WIDTH_PX = 40
const VERTICAL_LANE_WIDTH_PX = VERTICAL_TRACK_WIDTH_PX + 4
const VERTICAL_TERMINAL_WIDTH_PX = VERTICAL_LANE_WIDTH_PX
const VERTICAL_TITLE_BUTTON_THICKNESS_PX = VERTICAL_TRACK_WIDTH_PX - 8
const VERTICAL_TITLE_EDGE_INSET_PX = (VERTICAL_TRACK_WIDTH_PX - VERTICAL_TITLE_BUTTON_THICKNESS_PX) / 2
const CUSTOM_SCALE_SLOT_PADDING_PX = 4
const TIMELINE_SCALE_OPTIONS = [
  { id: '1h', label: '1h' },
  { id: '8h', label: '8h' },
  { id: '1d', label: '1d' },
  { id: '3d', label: '3d' },
  { id: '7d', label: '7d' },
  { id: '1m', label: '1m' },
  { id: '3m', label: '3m' },
  { id: '1y', label: '1y' },
  { id: 'custom', label: '自定义' },
] as const
const TIMELINE_LAYOUT_OPTIONS = [
  { key: 'vertical', label: '↕', title: '纵向模式', testId: 'task-timeline-layout-vertical' },
  { key: 'auto', label: 'A', title: '自动模式', testId: 'task-timeline-layout-auto' },
  { key: 'horizontal', label: '⟷', title: '横向模式', testId: 'task-timeline-layout-horizontal' },
] as const

type TimelinePresetScale = Exclude<(typeof TIMELINE_SCALE_OPTIONS)[number]['id'], 'custom'>
type TimelineScaleUnitBounds = Record<TimelineCustomScaleUnit, { min: number; max: number }>

const TIMELINE_SCALE_BOUNDS: TimelineScaleUnitBounds = {
  h: { min: 1, max: 23 },
  d: { min: 1, max: 30 },
  m: { min: 1, max: 12 },
  y: { min: 1, max: 10 },
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
  if (typeof range === 'string') return range
  return `${range.value}${range.unit}`
}

function formatRangeSummaryLabel(range: TimelineRange): string {
  if (typeof range === 'string') {
    return range
      .replace('h', '小时')
      .replace('d', '天')
      .replace('m', '月')
      .replace('y', '年')
  }
  return `${range.value}${range.unit}`
    .replace('h', '小时')
    .replace('d', '天')
    .replace('m', '月')
    .replace('y', '年')
}

function resolveCustomScaleDraft(range: TimelineRange): TimelineCustomRange {
  if (typeof range === 'object') {
    return range
  }
  if (range === '1h') {
    return { kind: 'custom', value: 1, unit: 'h' }
  }
  if (range === '8h') {
    return { kind: 'custom', value: 8, unit: 'h' }
  }
  if (range === '1m') {
    return { kind: 'custom', value: 1, unit: 'm' }
  }
  if (range === '3m') {
    return { kind: 'custom', value: 3, unit: 'm' }
  }
  if (range === '1y') {
    return { kind: 'custom', value: 1, unit: 'y' }
  }
  if (range === '3d') {
    return { kind: 'custom', value: 3, unit: 'd' }
  }
  if (range === '7d') {
    return { kind: 'custom', value: 7, unit: 'd' }
  }
  return { kind: 'custom', value: 1, unit: 'd' }
}

function resolveCustomScaleDraftText(range: TimelineRange): string {
  const draft = resolveCustomScaleDraft(range)
  return `${draft.value}${draft.unit}`
}

function parseCustomScaleDraft(rawValue: string): TimelineCustomRange | null {
  const normalizedValue = rawValue.trim().toLowerCase()
  const match = normalizedValue.match(/^(\d+)\s*([hdmy])$/)
  if (!match) {
    return null
  }

  const unit = match[2]?.toLowerCase() as TimelineCustomScaleUnit
  const bounds = TIMELINE_SCALE_BOUNDS[unit]
  const value = clamp(Number.parseInt(match[1] ?? '', 10), bounds.min, bounds.max)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return {
    kind: 'custom',
    value,
    unit,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function resolveTimelineScrollOffset(
  timestamp: number,
  displayTimeRange: { start: number; end: number },
  timelineMetrics: { primaryCanvasSize: number; viewportPrimarySize: number },
): number {
  const duration = displayTimeRange.end - displayTimeRange.start
  if (duration <= 0) {
    return 0
  }

  const positionRatio = clamp((timestamp - displayTimeRange.start) / duration, 0, 1)
  const maxScroll = Math.max(timelineMetrics.primaryCanvasSize - timelineMetrics.viewportPrimarySize, 0)
  const centeredOffset = positionRatio * timelineMetrics.primaryCanvasSize - timelineMetrics.viewportPrimarySize / 2
  return clamp(centeredOffset, 0, maxScroll)
}

function normalizeTimelineRange(range: TimelineCustomRange): TimelineRange {
  if (range.unit === 'h' && range.value === 1) return '1h'
  if (range.unit === 'h' && range.value === 8) return '8h'
  if (range.unit === 'd' && range.value === 1) return '1d'
  if (range.unit === 'd' && range.value === 3) return '3d'
  if (range.unit === 'd' && range.value === 7) return '7d'
  if (range.unit === 'm' && range.value === 1) return '1m'
  if (range.unit === 'm' && range.value === 3) return '3m'
  if (range.unit === 'y' && range.value === 1) return '1y'
  return range
}

function resolveRangeScale(range: TimelineRange): TimelineCustomRange {
  if (typeof range === 'object') {
    return range
  }
  switch (range) {
    case '1h':
      return { kind: 'custom', value: 1, unit: 'h' }
    case '8h':
      return { kind: 'custom', value: 8, unit: 'h' }
    case '1d':
      return { kind: 'custom', value: 1, unit: 'd' }
    case '3d':
      return { kind: 'custom', value: 3, unit: 'd' }
    case '7d':
      return { kind: 'custom', value: 7, unit: 'd' }
    case '1m':
      return { kind: 'custom', value: 1, unit: 'm' }
    case '3m':
      return { kind: 'custom', value: 3, unit: 'm' }
    case '1y':
      return { kind: 'custom', value: 1, unit: 'y' }
  }
}

function resolveTimelineIsHorizontal(layoutMode: TaskTimelineLayoutMode, isDesktop: boolean): boolean {
  if (layoutMode === 'horizontal') {
    return true
  }
  if (layoutMode === 'vertical') {
    return false
  }
  return isDesktop
}

function zoomTimelineRange(range: TimelineRange, direction: 'in' | 'out'): TimelineRange {
  const current = resolveRangeScale(range)
  const unitOrder: TimelineCustomScaleUnit[] = ['h', 'd', 'm', 'y']
  const currentIndex = unitOrder.indexOf(current.unit)
  const bounds = TIMELINE_SCALE_BOUNDS[current.unit]

  if (direction === 'in') {
    if (current.value > bounds.min) {
      return normalizeTimelineRange({ ...current, value: current.value - 1 })
    }
    if (current.unit === 'd') return { kind: 'custom', value: 23, unit: 'h' }
    if (current.unit === 'm') return { kind: 'custom', value: 30, unit: 'd' }
    if (current.unit === 'y') return { kind: 'custom', value: 12, unit: 'm' }
    return normalizeTimelineRange(current)
  }

  if (current.value < bounds.max) {
    return normalizeTimelineRange({ ...current, value: current.value + 1 })
  }

  const nextUnit = unitOrder[currentIndex + 1]
  if (!nextUnit) {
    return normalizeTimelineRange(current)
  }

  const bridgeValue = nextUnit === 'd' ? 1 : 1
  return normalizeTimelineRange({ kind: 'custom', value: bridgeValue, unit: nextUnit })
}

function resolveTimelineMetrics(
  timeRange: { start: number; end: number },
  scaleWindow: { start: number; end: number },
  isHorizontal: boolean,
  viewportSize: { width: number; height: number },
): { primaryCanvasSize: number; viewportPrimarySize: number; scaleDuration: number } {
  const scaleDuration = Math.max(scaleWindow.end - scaleWindow.start, 1)
  const totalDuration = Math.max(timeRange.end - timeRange.start, scaleDuration)
  const viewportPrimarySize = Math.max(
    isHorizontal ? viewportSize.width : viewportSize.height,
    isHorizontal ? HORIZONTAL_FALLBACK_VIEWPORT_PX : VERTICAL_FALLBACK_VIEWPORT_PX,
  )
  const pageCount = Math.max(totalDuration / scaleDuration, 1)

  return {
    primaryCanvasSize: Math.max(Math.ceil(viewportPrimarySize * pageCount), viewportPrimarySize),
    viewportPrimarySize,
    scaleDuration,
  }
}

function resolveDisplayTimeRange(
  contentRange: { start: number; end: number },
  scaleWindow: { start: number; end: number },
): { start: number; end: number } {
  const scaleDuration = Math.max(scaleWindow.end - scaleWindow.start, 1)
  const contentDuration = contentRange.end - contentRange.start
  const hourMs = 3_600_000
  const dayMs = 86_400_000
  const step = scaleDuration < dayMs ? hourMs : dayMs

  if (contentDuration <= 0) {
    return scaleWindow
  }

  if (contentDuration <= scaleDuration) {
    return scaleWindow
  }

  const paddedEnd = Math.ceil(Math.max(contentRange.end, scaleWindow.end) / step) * step
  return {
    start: contentRange.start,
    end: Math.max(paddedEnd, contentRange.start + scaleDuration),
  }
}

function resolveEntryAnchorTime(entry: TaskTimelineEntry): number {
  return entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? 0
}

function resolveHorizontalSegmentRounding(index: number, total: number): string {
  if (total <= 1) {
    return 'rounded-full'
  }
  if (index === 0) {
    return 'rounded-l-full rounded-r-none'
  }
  if (index === total - 1) {
    return 'rounded-r-full rounded-l-none'
  }
  return 'rounded-none'
}

function resolveVerticalSegmentRounding(index: number, total: number): string {
  if (total <= 1) {
    return 'rounded-full'
  }
  if (index === 0) {
    return 'rounded-t-full rounded-b-none'
  }
  if (index === total - 1) {
    return 'rounded-b-full rounded-t-none'
  }
  return 'rounded-none'
}

function resolveTimelineAxisUnit(range: TimelineRange): TimelineCustomScaleUnit {
  const scale = resolveRangeScale(range)

  if (scale.unit === 'y') {
    return scale.value > 1 ? 'y' : 'm'
  }
  if (scale.unit === 'm') {
    return scale.value > 1 ? 'm' : 'd'
  }
  if (scale.unit === 'd') {
    return scale.value > 1 ? 'd' : 'h'
  }
  return 'h'
}

function alignTimelineTickStart(timestamp: number, unit: TimelineCustomScaleUnit): number {
  const date = new Date(timestamp)

  if (unit === 'h') {
    date.setMinutes(0, 0, 0)
    if (date.getTime() < timestamp) {
      date.setHours(date.getHours() + 1)
    }
    return date.getTime()
  }

  if (unit === 'd') {
    date.setHours(0, 0, 0, 0)
    if (date.getTime() < timestamp) {
      date.setDate(date.getDate() + 1)
    }
    return date.getTime()
  }

  if (unit === 'm') {
    date.setDate(1)
    date.setHours(0, 0, 0, 0)
    if (date.getTime() < timestamp) {
      date.setMonth(date.getMonth() + 1)
    }
    return date.getTime()
  }

  date.setMonth(0, 1)
  date.setHours(0, 0, 0, 0)
  if (date.getTime() < timestamp) {
    date.setFullYear(date.getFullYear() + 1)
  }
  return date.getTime()
}

function advanceTimelineTick(timestamp: number, unit: TimelineCustomScaleUnit): number {
  const date = new Date(timestamp)

  if (unit === 'h') {
    date.setHours(date.getHours() + 1)
    return date.getTime()
  }
  if (unit === 'd') {
    date.setDate(date.getDate() + 1)
    return date.getTime()
  }
  if (unit === 'm') {
    date.setMonth(date.getMonth() + 1)
    return date.getTime()
  }

  date.setFullYear(date.getFullYear() + 1)
  return date.getTime()
}

function formatTimelineTickLabel(timestamp: number, unit: TimelineCustomScaleUnit): string {
  const date = new Date(timestamp)

  if (unit === 'h') {
    return `${String(date.getHours()).padStart(2, '0')}:00`
  }
  if (unit === 'd') {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  if (unit === 'm') {
    return `${date.getFullYear()}/${date.getMonth() + 1}`
  }
  return `${date.getFullYear()}`
}

function splitVerticalTitleLines(taskTitle: string): string[] {
  const asciiBuffer: string[] = []
  const lines: string[] = []

  const flushAsciiBuffer = () => {
    while (asciiBuffer.length > 0) {
      lines.push(asciiBuffer.splice(0, 2).join(''))
    }
  }

  for (const character of taskTitle.trim()) {
    if (/\s/.test(character)) {
      flushAsciiBuffer()
      continue
    }

    if (/[\x00-\x7F]/.test(character)) {
      asciiBuffer.push(character)
      if (asciiBuffer.length === 2) {
        flushAsciiBuffer()
      }
      continue
    }

    flushAsciiBuffer()
    lines.push(character)
  }

  flushAsciiBuffer()
  return lines.length > 0 ? lines : ['']
}

function TimelineTaskTitleButton({
  taskId,
  taskTitle,
  isSelected,
  isHorizontal,
  startPosition,
  collapsedPrimarySizePx,
  onSelectTask,
}: {
  taskId: string
  taskTitle: string
  isSelected: boolean
  isHorizontal: boolean
  startPosition: number
  collapsedPrimarySizePx: number
  onSelectTask: (taskId: string) => void
}) {
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [collapsedPrimarySizePxState, setCollapsedPrimarySizePxState] = useState(collapsedPrimarySizePx)
  const [expandedPrimarySizePx, setExpandedPrimarySizePx] = useState(collapsedPrimarySizePx)
  const verticalLines = useMemo(() => splitVerticalTitleLines(taskTitle), [taskTitle])

  useEffect(() => {
    const label = labelRef.current
    if (!label) {
      setCollapsedPrimarySizePxState(collapsedPrimarySizePx)
      setExpandedPrimarySizePx(collapsedPrimarySizePx)
      return
    }

    const paddingPx = isHorizontal ? 26 : 18
    const measuredSize = isHorizontal ? label.scrollWidth + paddingPx : label.scrollHeight + paddingPx
    setCollapsedPrimarySizePxState(Math.min(Math.max(measuredSize, 0), collapsedPrimarySizePx))
    setExpandedPrimarySizePx(Math.max(measuredSize, 0))
  }, [collapsedPrimarySizePx, isHorizontal, taskTitle])

  const primarySizePx = isHovered ? expandedPrimarySizePx : collapsedPrimarySizePxState

  return (
    <button
      type="button"
      data-testid={`timeline-title-${taskId}`}
      onClick={() => onSelectTask(taskId)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`absolute z-10 overflow-hidden border text-xs transition-[width,height] duration-[250ms] ease-out ${
        isHorizontal
          ? 'top-1/2 flex items-center whitespace-nowrap -translate-y-1/2 rounded-full px-3 text-left leading-5'
          : 'left-1/2 flex items-center justify-center -translate-x-1/2 rounded-[18px] px-1 py-2 text-center leading-4'
      } ${
        isSelected
          ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
          : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#3F3F46] dark:bg-[#292524] dark:text-[#D6D3D1]'
      }`}
      style={isHorizontal
        ? {
            left: `calc(${startPosition}% + ${TITLE_EDGE_INSET_PX}px)`,
            height: `${TITLE_BUTTON_THICKNESS_PX}px`,
            width: `${primarySizePx}px`,
          }
        : {
            top: `calc(${startPosition}% + ${VERTICAL_TITLE_EDGE_INSET_PX}px)`,
            width: `${VERTICAL_TITLE_BUTTON_THICKNESS_PX}px`,
            height: `${primarySizePx}px`,
          }}
    >
      <span ref={labelRef} className={`block overflow-hidden ${isHorizontal ? 'truncate' : 'text-center'}`}>
        {isHorizontal ? taskTitle : (
          <span className="flex flex-col items-center justify-center leading-4">
            {verticalLines.map((line, index) => (
              <span key={`${taskId}-${index}`} className="block">
                {line}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  )
}

function TimelineAxis({
  timeRange,
  isHorizontal,
  range,
}: {
  timeRange: { start: number; end: number }
  isHorizontal: boolean
  range: TimelineRange
}) {
  const duration = timeRange.end - timeRange.start
  const ticks: Array<{ position: number; label: string }> = []
  const axisUnit = resolveTimelineAxisUnit(range)

  if (duration <= 0) {
    return null
  }

  let current = alignTimelineTickStart(timeRange.start, axisUnit)
  while (current <= timeRange.end) {
    const position = ((current - timeRange.start) / duration) * 100
    ticks.push({ position, label: formatTimelineTickLabel(current, axisUnit) })
    current = advanceTimelineTick(current, axisUnit)
  }

  return (
    <div
      data-testid="timeline-axis"
      className={isHorizontal
        ? 'sticky top-0 z-20 h-8 select-none border-b border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]'
        : 'sticky left-0 z-20 w-14 shrink-0 select-none border-r border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]'
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
  displayTimeRange,
  range,
  isHorizontal,
  selectedTaskId,
  onSelectTask,
  onBackgroundClick,
  primaryCanvasSize,
}: {
  model: TaskTimelineModel
  displayTimeRange: { start: number; end: number }
  range: TimelineRange
  isHorizontal: boolean
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
  onBackgroundClick: () => void
  primaryCanvasSize: number
}) {
  const duration = displayTimeRange.end - displayTimeRange.start
  if (duration <= 0) {
    return null
  }

  const toPercent = (timestamp: number): number => {
    const percent = ((timestamp - displayTimeRange.start) / duration) * 100
    return Math.max(0, Math.min(100, percent))
  }

  if (model.lanes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#D6D3D1] bg-white/70 px-4 py-8 text-center text-sm text-[#78716C] dark:border-[#3F3F46] dark:bg-[#1C1917] dark:text-[#A8A29E]">
        当前还没有可展示的任务时间线。
      </div>
    )
  }

  if (isHorizontal) {
    return (
      <div
        className="min-w-full"
        style={{ width: `${primaryCanvasSize}px` }}
        onClick={(event) => {
          const target = event.target
          if (target instanceof HTMLElement && !target.closest('button, input, textarea')) {
            onBackgroundClick()
          }
        }}
      >
        <TimelineAxis timeRange={displayTimeRange} isHorizontal={true} range={range} />
        <div className="space-y-0">
          {model.lanes.map((lane, laneIndex) => (
            <div
              key={`lane-${laneIndex}`}
              className={`relative overflow-hidden bg-white/80 outline outline-1 -outline-offset-1 outline-[#E7E5E4] dark:bg-[#1C1917] dark:outline-[#292524] ${
                laneIndex > 0 ? '-mt-px' : ''
              } ${
                laneIndex === 0 ? 'rounded-t-[24px]' : ''
              } ${
                laneIndex === model.lanes.length - 1 ? 'rounded-b-[24px]' : ''
              }`}
              style={{ height: `${HORIZONTAL_LANE_HEIGHT_PX}px` }}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  onBackgroundClick()
                }
              }}
            >
              {lane.entries.map((entry) => {
                const anchorTime = resolveEntryAnchorTime(entry)
                const entryStartPosition = toPercent(entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? anchorTime)
                const entryEndPosition = toPercent(
                  entry.terminalMarker?.timestamp
                    ?? entry.segments[entry.segments.length - 1]?.endTime
                    ?? entry.segments[0]?.endTime
                    ?? anchorTime,
                )
                const titleMaxWidthPx = Math.max(
                  ((entryEndPosition - entryStartPosition) / 100) * primaryCanvasSize - TITLE_EDGE_INSET_PX * 2,
                  0,
                )
                const isSelected = selectedTaskId === entry.taskId

                return (
                  <div key={entry.taskId}>
                    <TimelineTaskTitleButton
                      taskId={entry.taskId}
                      taskTitle={entry.taskTitle}
                      isSelected={isSelected}
                      isHorizontal={true}
                      startPosition={entryStartPosition}
                      collapsedPrimarySizePx={titleMaxWidthPx}
                      onSelectTask={onSelectTask}
                    />
                    {entry.segments.map((segment, index) => {
                      const start = toPercent(segment.startTime)
                      const end = toPercent(segment.endTime)
                      const width = Math.max(end - start, 0)
                      const colors = STATUS_COLORS[segment.status]

                      return (
                        <button
                          key={`${entry.taskId}-${segment.startTime}-${index}`}
                          type="button"
                          data-testid={`timeline-segment-${entry.taskId}-${index}`}
                          title={`${entry.taskTitle} · ${colors.label}${segment.inferred ? '（推导）' : ''}`}
                          onClick={() => onSelectTask(entry.taskId)}
                          className={`absolute top-1/2 -translate-y-1/2 ${resolveHorizontalSegmentRounding(index, entry.segments.length)} ${segment.inferred ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-[#C75B3A]/40' : ''}`}
                          style={{
                            left: `${start}%`,
                            width: `${width}%`,
                            height: `${HORIZONTAL_TRACK_HEIGHT_PX}px`,
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
                        className={`absolute top-1/2 w-[4px] -translate-y-1/2 rounded-none ${isSelected ? 'shadow-[0_0_0_2px_rgba(199,91,58,0.24)]' : ''}`}
                        style={{
                          left: `${toPercent(entry.terminalMarker.timestamp)}%`,
                          height: `${HORIZONTAL_TERMINAL_HEIGHT_PX}px`,
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
    <div
      className="flex min-w-full"
      style={{ height: `${primaryCanvasSize}px` }}
      onClick={(event) => {
        const target = event.target
        if (target instanceof HTMLElement && !target.closest('button, input, textarea')) {
          onBackgroundClick()
        }
      }}
    >
      <TimelineAxis timeRange={displayTimeRange} isHorizontal={false} range={range} />
      <div className="flex flex-1 pl-3">
        <div className="flex">
        {model.lanes.map((lane, laneIndex) => (
            <div
            key={`lane-${laneIndex}`}
            className={`relative min-h-full bg-white/80 outline outline-1 -outline-offset-1 outline-[#E7E5E4] dark:bg-[#1C1917] dark:outline-[#292524] ${
              laneIndex > 0 ? '-ml-px' : ''
            } ${
              laneIndex === 0 ? 'rounded-l-[24px]' : ''
            } ${
              laneIndex === model.lanes.length - 1 ? 'rounded-r-[24px]' : ''
            }`}
            style={{ width: `${VERTICAL_LANE_WIDTH_PX}px` }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onBackgroundClick()
              }
            }}
          >
            {lane.entries.map((entry) => {
              const anchorTime = resolveEntryAnchorTime(entry)
              const entryStartPosition = toPercent(entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? anchorTime)
              const entryEndPosition = toPercent(
                entry.terminalMarker?.timestamp
                  ?? entry.segments[entry.segments.length - 1]?.endTime
                  ?? entry.segments[0]?.endTime
                  ?? anchorTime,
              )
              const titleMaxHeightPx = Math.max(
                ((entryEndPosition - entryStartPosition) / 100) * primaryCanvasSize - VERTICAL_TITLE_EDGE_INSET_PX * 2,
                0,
              )
              const isSelected = selectedTaskId === entry.taskId

              return (
                <div key={entry.taskId}>
                  <TimelineTaskTitleButton
                    taskId={entry.taskId}
                    taskTitle={entry.taskTitle}
                    isSelected={isSelected}
                    isHorizontal={false}
                    startPosition={entryStartPosition}
                    collapsedPrimarySizePx={titleMaxHeightPx}
                    onSelectTask={onSelectTask}
                  />
                  {entry.segments.map((segment, index) => {
                    const start = toPercent(segment.startTime)
                    const end = toPercent(segment.endTime)
                    const height = Math.max(end - start, 0)
                    const colors = STATUS_COLORS[segment.status]

                    return (
                      <button
                        key={`${entry.taskId}-${segment.startTime}-${index}`}
                        type="button"
                        data-testid={`timeline-segment-${entry.taskId}-${index}`}
                        title={`${entry.taskTitle} · ${colors.label}${segment.inferred ? '（推导）' : ''}`}
                        onClick={() => onSelectTask(entry.taskId)}
                        className={`absolute left-1/2 -translate-x-1/2 ${resolveVerticalSegmentRounding(index, entry.segments.length)} ${segment.inferred ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-[#C75B3A]/40' : ''}`}
                        style={{
                          top: `${start}%`,
                          height: `${height}%`,
                          width: `${VERTICAL_TRACK_WIDTH_PX}px`,
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
                        className={`absolute left-1/2 h-[4px] -translate-x-1/2 rounded-none ${isSelected ? 'shadow-[0_0_0_2px_rgba(199,91,58,0.24)]' : ''}`}
                        style={{
                          top: `${toPercent(entry.terminalMarker.timestamp)}%`,
                          width: `${VERTICAL_TERMINAL_WIDTH_PX}px`,
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
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const lastFocusKeyRef = useRef<string | null>(null)
  const customScaleInputRef = useRef<HTMLInputElement | null>(null)
  const initialRange = useMemo(() => readPersistedRange(), [])
  const initialCustomScaleDraft = useMemo(() => resolveCustomScaleDraftText(initialRange), [initialRange])

  const [tasks, setTasks] = useState<TaskNode[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [range, setRange] = useState<TimelineRange>(initialRange)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => readPersistedSelectedTaskId())
  const [showPending, setShowPending] = useState(() => readPersistedShowPending())
  const [layoutMode, setLayoutMode] = useState<TaskTimelineLayoutMode>(() => readPersistedLayoutMode())
  const [isCustomScaleEditing, setIsCustomScaleEditing] = useState(false)
  const [customScaleDraft, setCustomScaleDraft] = useState(initialCustomScaleDraft)
  const [timelineViewportSize, setTimelineViewportSize] = useState({ width: 0, height: 0 })
  const isHorizontalTimeline = resolveTimelineIsHorizontal(layoutMode, isDesktop)
  const scaleOptions = TIMELINE_SCALE_OPTIONS
  const selectedScaleIndex = isCustomScaleEditing || typeof range === 'object'
    ? scaleOptions.length - 1
    : Math.max(scaleOptions.findIndex((option) => option.id === range), 0)

  const handleSetRange = (nextRange: TimelineRange) => {
    persistTimelineRange(nextRange)
    setRange(nextRange)
  }

  const handleSetShowPending = (nextShowPending: boolean) => {
    persistTimelineShowPending(nextShowPending)
    setShowPending(nextShowPending)
  }

  const handleSetLayoutMode = (nextLayoutMode: TaskTimelineLayoutMode) => {
    persistTimelineLayoutMode(nextLayoutMode)
    setLayoutMode(nextLayoutMode)
  }

  const handleSelectTask = (taskId: string | null) => {
    persistTimelineSelectedTaskId(taskId)
    setSelectedTaskId(taskId)
  }

  const openCustomScaleEditor = () => {
    setCustomScaleDraft(resolveCustomScaleDraftText(range))
    setIsCustomScaleEditing(true)
  }

  const closeCustomScaleEditor = () => {
    setIsCustomScaleEditing(false)
  }

  useEffect(() => {
    sessionStorage.setItem(TASKS_LAST_PATH_KEY, '/tasks/timeline')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => {}
    }

    const handleStorage = (event: StorageEvent) => {
      switch (event.key) {
        case TASK_TIMELINE_RANGE_STORAGE_KEY: {
          const nextRange = readPersistedRange()
          setRange(nextRange)
          setCustomScaleDraft(resolveCustomScaleDraftText(nextRange))
          return
        }
        case TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY:
          setSelectedTaskId(readPersistedSelectedTaskId())
          return
        case TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY:
          setShowPending(readPersistedShowPending())
          return
        case TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY:
          setLayoutMode(readPersistedLayoutMode())
          return
        default:
          return
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (!isCustomScaleEditing) {
      return
    }

    requestAnimationFrame(() => {
      customScaleInputRef.current?.focus()
      customScaleInputRef.current?.select()
    })
  }, [isCustomScaleEditing])

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
  const scaleWindow = useMemo(() => resolveTimeRange(range, Date.now()), [range])
  const displayTimeRange = useMemo(() => (
    resolveDisplayTimeRange(model.timeRange, scaleWindow)
  ), [model.timeRange, scaleWindow])
  const timelineMetrics = useMemo(() => (
    resolveTimelineMetrics(displayTimeRange, scaleWindow, isHorizontalTimeline, timelineViewportSize)
  ), [displayTimeRange, isHorizontalTimeline, scaleWindow, timelineViewportSize])

  const selectedEntry = model.entries.find((entry) => entry.taskId === selectedTaskId) ?? null

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }
    if (!model.entries.some((entry) => entry.taskId === selectedTaskId)) {
      handleSelectTask(null)
    }
  }, [model.entries, selectedTaskId])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) {
      return
    }

    const update = () => {
      setTimelineViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }

    update()

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update)
      observer.observe(viewport)
    }
    window.addEventListener('resize', update)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    const totalDuration = displayTimeRange.end - displayTimeRange.start
    if (!viewport || totalDuration <= 0) {
      return
    }

    const maxFocusStart = Math.max(displayTimeRange.end - timelineMetrics.scaleDuration, displayTimeRange.start)
    const focusStart = clamp(scaleWindow.start, displayTimeRange.start, maxFocusStart)
    const focusRatio = (focusStart - displayTimeRange.start) / totalDuration
    const maxScroll = Math.max(timelineMetrics.primaryCanvasSize - timelineMetrics.viewportPrimarySize, 0)
    const nextScroll = clamp(focusRatio * timelineMetrics.primaryCanvasSize, 0, maxScroll)
    const nextFocusKey = [
      serializeRange(range),
      isHorizontalTimeline ? 'horizontal' : 'vertical',
      displayTimeRange.start,
      displayTimeRange.end,
      timelineMetrics.primaryCanvasSize,
      timelineMetrics.viewportPrimarySize,
    ].join(':')

    if (lastFocusKeyRef.current === nextFocusKey) {
      return
    }

    if (isHorizontalTimeline) {
      viewport.scrollTo({ left: nextScroll })
    } else {
      viewport.scrollTo({ top: nextScroll })
    }
    lastFocusKeyRef.current = nextFocusKey
  }, [displayTimeRange.end, displayTimeRange.start, isHorizontalTimeline, range, scaleWindow.start, timelineMetrics.primaryCanvasSize, timelineMetrics.scaleDuration, timelineMetrics.viewportPrimarySize])

  const handleApplyCustomScale = () => {
    const nextRange = parseCustomScaleDraft(customScaleDraft)
    if (!nextRange) {
      setCustomScaleDraft(resolveCustomScaleDraftText(range))
      closeCustomScaleEditor()
      return
    }
    const normalizedRange = normalizeTimelineRange(nextRange)
    setCustomScaleDraft(formatRangeLabel(normalizedRange))
    handleSetRange(normalizedRange)
    closeCustomScaleEditor()
  }

  const handleJumpToNow = () => {
    const viewport = scrollViewportRef.current
    if (!viewport) {
      return
    }

    const nextScroll = resolveTimelineScrollOffset(Date.now(), displayTimeRange, timelineMetrics)
    if (isHorizontalTimeline) {
      viewport.scrollTo({ left: nextScroll, behavior: 'smooth' })
    } else {
      viewport.scrollTo({ top: nextScroll, behavior: 'smooth' })
    }
  }

  const handleTimelineBackgroundClick = () => {
    handleSelectTask(null)
  }

  const handleTimelineWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return
    }

    const target = event.target
    if (target instanceof HTMLElement && target.closest('input, textarea')) {
      return
    }

    event.preventDefault()
    const nextRange = zoomTimelineRange(range, event.deltaY < 0 ? 'in' : 'out')
    handleSetRange(nextRange)
    closeCustomScaleEditor()
  }

  return (
    <div className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-timeline-page">
      <header className="border-b border-[#F0ECE8] px-5 py-4 dark:border-[#292524] md:px-8 lg:px-10">
        <TaskBreadcrumb segments={[{ label: '任务', to: '/tasks' }]} current={{ label: '时间线', icon: Clock }} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务时间线</h1>
            <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
              以任务为主语纵览完整时间轴，比例尺决定单屏能容纳的时间跨度。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[min(100%,40rem)] max-w-full shrink-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-white/80 p-1 dark:border-[#292524] dark:bg-[#1C1917]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
                style={{
                  width: `calc((100% - ${CUSTOM_SCALE_SLOT_PADDING_PX * 2}px) / ${scaleOptions.length})`,
                  transform: `translateX(${selectedScaleIndex * 100}%)`,
                }}
              />
              <div
                className="relative z-10 grid min-w-0 gap-0"
                style={{ gridTemplateColumns: `repeat(${scaleOptions.length}, minmax(0, 1fr))` }}
              >
                {scaleOptions.map((option) => (
                  option.id === 'custom' ? (
                    isCustomScaleEditing ? (
                      <input
                        key={option.id}
                        ref={customScaleInputRef}
                        data-testid="task-timeline-custom-scale-input"
                        value={customScaleDraft}
                        onChange={(event) => {
                          setCustomScaleDraft(event.target.value.replace(/[^0-9hdmyHDMY\s]/g, ''))
                        }}
                        onBlur={handleApplyCustomScale}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            handleApplyCustomScale()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setCustomScaleDraft(resolveCustomScaleDraftText(range))
                            closeCustomScaleEditor()
                          }
                        }}
                        aria-label="自定义比例尺（Custom timeline scale）"
                        placeholder="12h"
                        className="relative z-10 h-8 w-full min-w-0 max-w-full rounded-[8px] border-transparent bg-transparent px-[8px] text-center text-[12px] font-semibold text-[#1C1917] outline-none ring-0 focus-visible:ring-0 dark:text-[#FAFAF9]"
                      />
                    ) : (
                      <button
                        key={option.id}
                        type="button"
                        onClick={openCustomScaleEditor}
                        className={`relative z-10 flex h-8 w-full min-w-0 max-w-full select-none items-center justify-center overflow-hidden rounded-[8px] px-2 text-center text-[12px] transition-colors duration-200 ${
                          typeof range === 'object'
                            ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                            : 'text-[#C75B3A] hover:text-[#B24D2F]'
                        }`}
                        aria-label="自定义比例尺（Custom timeline scale）"
                      >
                        {typeof range === 'object' ? <ChevronDown size={12} className="mr-1 transition-transform" /> : null}
                        <span className={typeof range === 'object' ? 'truncate' : ''}>
                          {typeof range === 'object' ? `${range.value}${range.unit}` : option.label}
                        </span>
                      </button>
                    )
                  ) : (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        handleSetRange(option.id as TimelinePresetScale)
                        closeCustomScaleEditor()
                      }}
                      className={`relative z-10 h-8 min-w-[64px] select-none rounded-[8px] px-3 text-center text-[12px] transition-colors duration-200 ${
                        range === option.id
                          ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                          : 'text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSetShowPending(!showPending)}
              aria-pressed={showPending}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                showPending
                  ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                  : 'border-[#E7E3E0] bg-white text-[#57534E] hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917] dark:text-[#A8A29E]'
              }`}
            >
              显示待办段
            </button>
            <button
              type="button"
              onClick={handleJumpToNow}
              className="rounded-full border border-[#E7E3E0] bg-white px-3 py-1.5 text-xs font-medium text-[#57534E] transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917] dark:text-[#A8A29E]"
            >
              回到当下
            </button>
            <SlidingSegmentedControl
              options={TIMELINE_LAYOUT_OPTIONS}
              value={layoutMode}
              onChange={handleSetLayoutMode}
              className="bg-white/80 dark:border-[#292524] dark:bg-[#1C1917]"
              buttonClassName="h-8 px-2 text-[12px]"
              minButtonWidthClassName="min-w-[40px]"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">比例尺：{formatRangeSummaryLabel(range)}</span>
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">任务：{model.entries.length}</span>
          <span className="rounded-full bg-[#F5F0ED] px-2 py-1 dark:bg-[#292524]">泳道：{model.lanes.length}</span>
        </div>
        <div className="mt-3">
          <TaskDomainTabs active="timeline" />
        </div>
      </header>

      <div
        ref={scrollViewportRef}
        data-testid="task-timeline-scroll-viewport"
        onWheel={handleTimelineWheel}
        onClick={(event) => {
          const target = event.target
          if (target instanceof HTMLElement && target === event.currentTarget) {
            handleTimelineBackgroundClick()
          }
        }}
        className="min-h-0 flex-1 overflow-auto px-5 pb-4 pt-0 md:px-8 lg:px-10"
      >
        <TimelineSwimLane
          model={model}
          displayTimeRange={displayTimeRange}
          range={range}
          isHorizontal={isHorizontalTimeline}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
          onBackgroundClick={handleTimelineBackgroundClick}
          primaryCanvasSize={timelineMetrics.primaryCanvasSize}
        />
      </div>

      {selectedEntry ? (
        <TimelineDetailPanel
          entry={selectedEntry}
          onClose={() => handleSelectTask(null)}
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
