import { SYSTEM_TAGS, type Event, type TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'

export type TimelineRange = 'today' | '3d' | '7d' | { start: number; end: number }

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
  if (typeof range === 'object') {
    return range
  }

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const end = now

  switch (range) {
    case '3d':
      return { start: todayStart.getTime() - DAY_MS * 2, end }
    case '7d':
      return { start: todayStart.getTime() - DAY_MS * 6, end }
    case 'today':
    default:
      return { start: todayStart.getTime(), end }
  }
}

function buildSegmentsFromEvents(
  taskId: string,
  taskTitle: string,
  events: Event[],
  timeRange: { start: number; end: number },
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
      endTime: timeRange.end,
      inferred: false,
    })
  }

  return { segments, terminalMarker }
}

function buildSegmentsFromTimeBlocks(
  task: TaskNode,
  timeBlocks: TimeBlock[],
  timeRange: { start: number; end: number },
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
        endTime: timeRange.end,
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

function assignLanes(entries: TaskTimelineEntry[]): SwimLane[] {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftStart = left.segments[0]?.startTime ?? Number.MAX_SAFE_INTEGER
    const rightStart = right.segments[0]?.startTime ?? Number.MAX_SAFE_INTEGER
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
  const timeRange = resolveTimeRange(range, Date.now())
  const entries: TaskTimelineEntry[] = []

  for (const task of tasks) {
    const hasTaskEvents = events.some((event) => isTaskEvent(event) && readTaskEventTaskId(event) === task.id)
    const timeline = hasTaskEvents
      ? buildSegmentsFromEvents(task.id, task.title, events, timeRange)
      : buildSegmentsFromTimeBlocks(task, timeBlocks, timeRange)

    const filteredSegments = timeline.segments.filter((segment) =>
      segment.endTime > timeRange.start && segment.startTime < timeRange.end,
    )
    const visibleSegments = options.showPending
      ? filteredSegments
      : filteredSegments.filter((segment) => segment.status !== 'pending')
    const terminalMarker = timeline.terminalMarker
      && timeline.terminalMarker.timestamp >= timeRange.start
      && timeline.terminalMarker.timestamp <= timeRange.end
      ? timeline.terminalMarker
      : null

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
    timeRange,
    entries,
  }
}
