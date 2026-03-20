import { SYSTEM_TAGS, type Event, type TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'

export type TimelinePresetRange = '1h' | '8h' | '1d' | '3d' | '7d' | '1m' | '3m' | '1y'
export type TimelineCustomScaleUnit = 'h' | 'd' | 'm' | 'y'

export interface TimelineCustomRange {
  kind: 'custom'
  value: number
  unit: TimelineCustomScaleUnit
}

export type TimelineRange = TimelinePresetRange | TimelineCustomRange

export interface TaskStatusSegment {
  taskId: string
  taskTitle: string
  status: 'pending' | 'in_progress' | 'suspended'
  startTime: number
  endTime: number
  inferred: boolean
}

export interface TaskTerminalMarker {
  taskId: string
  taskTitle: string
  status: 'completed' | 'cancelled'
  timestamp: number
  inferred: boolean
}

export interface TaskTimelineEntry {
  taskId: string
  taskTitle: string
  currentStatus: TaskNode['status']
  segments: TaskStatusSegment[]
  terminalMarker: TaskTerminalMarker | null
}

export interface SwimLane {
  entries: TaskTimelineEntry[]
}

export interface TaskTimelineModel {
  lanes: SwimLane[]
  timeRange: { start: number; end: number }
  entries: TaskTimelineEntry[]
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const TASK_EVENT_TAGS = new Set([
  SYSTEM_TAGS.TASK_CREATED,
  SYSTEM_TAGS.TASK_STARTED,
  SYSTEM_TAGS.TASK_RESUMED,
  SYSTEM_TAGS.TASK_SUSPENDED,
  SYSTEM_TAGS.TASK_COMPLETED,
  SYSTEM_TAGS.TASK_CANCELLED,
])

type TaskEventStatus = TaskStatusSegment['status'] | TaskTerminalMarker['status']

function isTaskEvent(event: Event): boolean {
  for (const tag of event.tags) {
    if (TASK_EVENT_TAGS.has(tag)) {
      return true
    }
  }
  return false
}

function readTaskEventTaskId(event: Event): string | null {
  const taskId = event.metadata?.taskId
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null
}

function readTaskTransitionStatus(event: Event): TaskEventStatus | null {
  const toStatus = event.metadata?.toStatus
  if (toStatus === 'pending' || toStatus === 'in_progress' || toStatus === 'suspended' || toStatus === 'completed' || toStatus === 'cancelled') {
    return toStatus
  }
  return null
}

export function resolveTimeRange(range: TimelineRange, now: number): { start: number; end: number } {
  const nowDate = new Date(now)
  const todayStart = new Date(nowDate)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setHours(23, 59, 59, 999)
  const currentMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1)
  const currentMonthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const currentYearStart = new Date(nowDate.getFullYear(), 0, 1)
  const currentYearEnd = new Date(nowDate.getFullYear(), 11, 31, 23, 59, 59, 999)

  if (typeof range === 'object' && range.kind === 'custom') {
    const safeValue = Math.max(1, Math.floor(range.value))
    if (range.unit === 'h') {
      return {
        start: now - safeValue * HOUR_MS,
        end: now,
      }
    }

    if (range.unit === 'd') {
      return {
        start: todayStart.getTime() - DAY_MS * (safeValue - 1),
        end: todayEnd.getTime(),
      }
    }

    if (range.unit === 'm') {
      return {
        start: new Date(nowDate.getFullYear(), nowDate.getMonth() - (safeValue - 1), 1).getTime(),
        end: currentMonthEnd.getTime(),
      }
    }

    return {
      start: new Date(nowDate.getFullYear() - (safeValue - 1), 0, 1).getTime(),
      end: currentYearEnd.getTime(),
    }
  }

  switch (range) {
    case '1h':
      return { start: now - HOUR_MS, end: now }
    case '8h':
      return { start: now - 8 * HOUR_MS, end: now }
    case '1d':
      return { start: todayStart.getTime(), end: todayEnd.getTime() }
    case '3d':
      return { start: todayStart.getTime() - DAY_MS * 2, end: todayEnd.getTime() }
    case '7d':
      return { start: todayStart.getTime() - DAY_MS * 6, end: todayEnd.getTime() }
    case '1m':
      return { start: currentMonthStart.getTime(), end: currentMonthEnd.getTime() }
    case '3m':
      return {
        start: new Date(nowDate.getFullYear(), nowDate.getMonth() - 2, 1).getTime(),
        end: currentMonthEnd.getTime(),
      }
    case '1y':
      return { start: currentYearStart.getTime(), end: currentYearEnd.getTime() }
    default:
      return { start: todayStart.getTime(), end: todayEnd.getTime() }
  }
}

function buildSegmentsFromEvents(
  taskId: string,
  taskTitle: string,
  events: Event[],
  timelineEnd: number,
): { segments: TaskStatusSegment[]; terminalMarker: TaskTerminalMarker | null } {
  const taskEvents = events
    .filter((event) => isTaskEvent(event) && readTaskEventTaskId(event) === taskId)
    .sort((left, right) => left.timestamp - right.timestamp)

  if (taskEvents.length === 0) {
    return { segments: [], terminalMarker: null }
  }

  const segments: TaskStatusSegment[] = []
  let terminalMarker: TaskTerminalMarker | null = null
  let currentStatus: TaskStatusSegment['status'] | null = null
  let segmentStart: number | null = null

  for (const event of taskEvents) {
    if (event.tags.has(SYSTEM_TAGS.TASK_CREATED)) {
      currentStatus = 'pending'
      segmentStart = event.timestamp
      continue
    }

    if (event.tags.has(SYSTEM_TAGS.TASK_COMPLETED) || event.tags.has(SYSTEM_TAGS.TASK_CANCELLED)) {
      if (currentStatus && segmentStart !== null) {
        segments.push({
          taskId,
          taskTitle,
          status: currentStatus,
          startTime: segmentStart,
          endTime: event.timestamp,
          inferred: false,
        })
      }

      terminalMarker = {
        taskId,
        taskTitle,
        status: event.tags.has(SYSTEM_TAGS.TASK_COMPLETED) ? 'completed' : 'cancelled',
        timestamp: event.timestamp,
        inferred: false,
      }
      currentStatus = null
      segmentStart = null
      continue
    }

    const toStatus = readTaskTransitionStatus(event)
    if (!toStatus || toStatus === 'completed' || toStatus === 'cancelled') {
      continue
    }

    if (currentStatus && segmentStart !== null) {
      segments.push({
        taskId,
        taskTitle,
        status: currentStatus,
        startTime: segmentStart,
        endTime: event.timestamp,
        inferred: false,
      })
    }

    currentStatus = toStatus
    segmentStart = event.timestamp
  }

  if (currentStatus && segmentStart !== null) {
    segments.push({
      taskId,
      taskTitle,
      status: currentStatus,
      startTime: segmentStart,
      endTime: timelineEnd,
      inferred: false,
    })
  }

  return { segments, terminalMarker }
}

function buildSegmentsFromTimeBlocks(
  task: TaskNode,
  timeBlocks: TimeBlock[],
  timelineEnd: number,
): { segments: TaskStatusSegment[]; terminalMarker: TaskTerminalMarker | null } {
  const blockIds = new Set(task.timeBlockIds ?? [])
  const relatedBlocks = timeBlocks
    .filter((block) => blockIds.has(block.startId))
    .sort((left, right) => left.startTime - right.startTime)

  if (relatedBlocks.length === 0) {
    return {
      segments: [{
        taskId: task.id,
        taskTitle: task.title,
        status: 'pending',
        startTime: task.createdAt,
        endTime: timelineEnd,
        inferred: true,
      }],
      terminalMarker: task.status === 'completed' || task.status === 'cancelled'
        ? {
            taskId: task.id,
            taskTitle: task.title,
            status: task.status,
            timestamp: task.completedAt ?? task.updatedAt,
            inferred: true,
          }
        : null,
    }
  }

  const segments: TaskStatusSegment[] = []

  const firstBlock = relatedBlocks[0]
  if (firstBlock && firstBlock.startTime > task.createdAt) {
    segments.push({
      taskId: task.id,
      taskTitle: task.title,
      status: 'pending',
      startTime: task.createdAt,
      endTime: firstBlock.startTime,
      inferred: true,
    })
  }

  for (const block of relatedBlocks) {
    segments.push({
      taskId: task.id,
      taskTitle: task.title,
      status: 'in_progress',
      startTime: block.startTime,
      endTime: block.endTime,
      inferred: true,
    })
  }

  const lastBlock = relatedBlocks[relatedBlocks.length - 1]
  const terminalMarker = task.status === 'completed' || task.status === 'cancelled'
    ? {
        taskId: task.id,
        taskTitle: task.title,
        status: task.status,
        timestamp: lastBlock?.endTime ?? task.completedAt ?? task.updatedAt,
        inferred: true,
      }
    : null

  return { segments, terminalMarker }
}

function resolveEntryEnd(entry: TaskTimelineEntry): number {
  return entry.terminalMarker?.timestamp
    ?? entry.segments[entry.segments.length - 1]?.endTime
    ?? 0
}

function resolveEntryStart(entry: TaskTimelineEntry): number {
  return entry.segments[0]?.startTime
    ?? entry.terminalMarker?.timestamp
    ?? 0
}

function resolveModelTimeRange(
  entries: TaskTimelineEntry[],
  fallbackRange: { start: number; end: number },
): { start: number; end: number } {
  if (entries.length === 0) {
    return fallbackRange
  }

  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY

  for (const entry of entries) {
    start = Math.min(start, resolveEntryStart(entry))
    end = Math.max(end, resolveEntryEnd(entry))
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return fallbackRange
  }

  return { start, end }
}

function assignLanes(entries: TaskTimelineEntry[]): SwimLane[] {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftStart = resolveEntryStart(left) || Number.MAX_SAFE_INTEGER
    const rightStart = resolveEntryStart(right) || Number.MAX_SAFE_INTEGER
    return leftStart - rightStart
  })

  const lanes: SwimLane[] = []

  for (const entry of sortedEntries) {
    const entryStart = entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? 0
    let assigned = false

    for (const lane of lanes) {
      const laneEnd = Math.max(...lane.entries.map(resolveEntryEnd))
      if (entryStart >= laneEnd) {
        lane.entries.push(entry)
        assigned = true
        break
      }
    }

    if (!assigned) {
      lanes.push({ entries: [entry] })
    }
  }

  return lanes
}

export function buildTaskTimelineModel(
  tasks: TaskNode[],
  events: Event[],
  timeBlocks: TimeBlock[],
  range: TimelineRange,
  options: { showPending: boolean } = { showPending: false },
): TaskTimelineModel {
  const scaleRange = resolveTimeRange(range, Date.now())
  const timelineEnd = Date.now()
  const entries: TaskTimelineEntry[] = []

  for (const task of tasks) {
    const hasTaskEvents = events.some((event) => isTaskEvent(event) && readTaskEventTaskId(event) === task.id)
    const timeline = hasTaskEvents
      ? buildSegmentsFromEvents(task.id, task.title, events, timelineEnd)
      : buildSegmentsFromTimeBlocks(task, timeBlocks, timelineEnd)

    const visibleSegments = options.showPending
      ? timeline.segments
      : timeline.segments.filter((segment) => segment.status !== 'pending')
    const terminalMarker = timeline.terminalMarker

    if (visibleSegments.length === 0 && !terminalMarker) {
      continue
    }

    entries.push({
      taskId: task.id,
      taskTitle: task.title,
      currentStatus: task.status,
      segments: visibleSegments,
      terminalMarker,
    })
  }

  return {
    lanes: assignLanes(entries),
    timeRange: resolveModelTimeRange(entries, scaleRange),
    entries,
  }
}
