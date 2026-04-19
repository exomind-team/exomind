import type { TaskNode } from "@/lib/types/task";

export type TimelinePresetRange =
  | "1h"
  | "8h"
  | "1d"
  | "3d"
  | "7d"
  | "1m"
  | "3m"
  | "1y";
export type TimelineCustomScaleUnit = "h" | "d" | "m" | "y";

export interface TimelineCustomRange {
  kind: "custom";
  value: number;
  unit: TimelineCustomScaleUnit;
}

export type TimelineRange = TimelinePresetRange | TimelineCustomRange;

export interface TaskStatusSegment {
  taskId: string;
  taskTitle: string;
  status: "pending" | "in_progress" | "suspended";
  startTime: number;
  endTime: number;
}

export interface TaskTerminalMarker {
  taskId: string;
  taskTitle: string;
  status: "completed" | "cancelled";
  timestamp: number;
}

export interface TaskTimelineEntry {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskNode["status"];
  segments: TaskStatusSegment[];
  terminalMarker: TaskTerminalMarker | null;
}

export interface SwimLane {
  entries: TaskTimelineEntry[];
}

export interface TaskTimelineModel {
  lanes: SwimLane[];
  timeRange: { start: number; end: number };
  entries: TaskTimelineEntry[];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function isTerminalStatus(
  status: TaskNode["status"],
): status is TaskTerminalMarker["status"] {
  return status === "completed" || status === "cancelled";
}

export function resolveTimeRange(
  range: TimelineRange,
  now: number,
): { start: number; end: number } {
  const nowDate = new Date(now);
  const todayStart = new Date(nowDate);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const currentMonthStart = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    1,
  );
  const currentMonthEnd = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const currentYearStart = new Date(nowDate.getFullYear(), 0, 1);
  const currentYearEnd = new Date(
    nowDate.getFullYear(),
    11,
    31,
    23,
    59,
    59,
    999,
  );

  if (typeof range === "object" && range.kind === "custom") {
    const safeValue = Math.max(1, Math.floor(range.value));
    if (range.unit === "h") {
      return {
        start: now - safeValue * HOUR_MS,
        end: now,
      };
    }

    if (range.unit === "d") {
      return {
        start: todayStart.getTime() - DAY_MS * (safeValue - 1),
        end: todayEnd.getTime(),
      };
    }

    if (range.unit === "m") {
      return {
        start: new Date(
          nowDate.getFullYear(),
          nowDate.getMonth() - (safeValue - 1),
          1,
        ).getTime(),
        end: currentMonthEnd.getTime(),
      };
    }

    return {
      start: new Date(nowDate.getFullYear() - (safeValue - 1), 0, 1).getTime(),
      end: currentYearEnd.getTime(),
    };
  }

  switch (range) {
    case "1h":
      return { start: now - HOUR_MS, end: now };
    case "8h":
      return { start: now - 8 * HOUR_MS, end: now };
    case "1d":
      return { start: todayStart.getTime(), end: todayEnd.getTime() };
    case "3d":
      return {
        start: todayStart.getTime() - DAY_MS * 2,
        end: todayEnd.getTime(),
      };
    case "7d":
      return {
        start: todayStart.getTime() - DAY_MS * 6,
        end: todayEnd.getTime(),
      };
    case "1m":
      return {
        start: currentMonthStart.getTime(),
        end: currentMonthEnd.getTime(),
      };
    case "3m":
      return {
        start: new Date(
          nowDate.getFullYear(),
          nowDate.getMonth() - 2,
          1,
        ).getTime(),
        end: currentMonthEnd.getTime(),
      };
    case "1y":
      return {
        start: currentYearStart.getTime(),
        end: currentYearEnd.getTime(),
      };
    default:
      return { start: todayStart.getTime(), end: todayEnd.getTime() };
  }
}

function buildTimelineFromStatusTransitions(
  task: TaskNode,
  timelineEnd: number,
): {
  segments: TaskStatusSegment[];
  terminalMarker: TaskTerminalMarker | null;
} {
  const transitions = [...(task.statusTransitions ?? [])];

  if (transitions.length === 0) {
    return { segments: [], terminalMarker: null };
  }

  const segments: TaskStatusSegment[] = [];

  for (let index = 0; index < transitions.length; index += 1) {
    const current = transitions[index];
    if (!current) {
      continue;
    }

    if (isTerminalStatus(current.toStatus)) {
      continue;
    }

    const nextTransition = transitions[index + 1];
    const endTime =
      nextTransition?.at ?? Math.max(timelineEnd, current.at + 1);
    if (endTime <= current.at) {
      continue;
    }

    segments.push({
      taskId: task.id,
      taskTitle: task.title,
      status: current.toStatus,
      startTime: current.at,
      endTime,
    });
  }

  const lastTransition = transitions[transitions.length - 1];
  const terminalMarker =
    lastTransition && isTerminalStatus(lastTransition.toStatus)
      ? {
          taskId: task.id,
          taskTitle: task.title,
          status: lastTransition.toStatus,
          timestamp: lastTransition.at,
        }
      : null;

  return { segments, terminalMarker };
}

function resolveEntryCurrentStatus(
  task: TaskNode,
  timeline: {
    segments: TaskStatusSegment[];
    terminalMarker: TaskTerminalMarker | null;
  },
): TaskNode["status"] {
  if (timeline.terminalMarker) {
    return timeline.terminalMarker.status;
  }

  const lastSegment = timeline.segments[timeline.segments.length - 1];
  if (lastSegment) {
    return lastSegment.status;
  }

  return task.status;
}

function resolveEntryEnd(entry: TaskTimelineEntry): number {
  return (
    entry.terminalMarker?.timestamp ??
    entry.segments[entry.segments.length - 1]?.endTime ??
    0
  );
}

function resolveEntryStart(entry: TaskTimelineEntry): number {
  return entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? 0;
}

function resolveModelTimeRange(
  entries: TaskTimelineEntry[],
  fallbackRange: { start: number; end: number },
): { start: number; end: number } {
  if (entries.length === 0) {
    return fallbackRange;
  }

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    start = Math.min(start, resolveEntryStart(entry));
    end = Math.max(end, resolveEntryEnd(entry));
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return fallbackRange;
  }

  return { start, end };
}

function assignLanes(entries: TaskTimelineEntry[]): SwimLane[] {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftStart = resolveEntryStart(left) || Number.MAX_SAFE_INTEGER;
    const rightStart = resolveEntryStart(right) || Number.MAX_SAFE_INTEGER;
    return leftStart - rightStart;
  });

  const lanes: SwimLane[] = [];

  for (const entry of sortedEntries) {
    const entryStart =
      entry.segments[0]?.startTime ?? entry.terminalMarker?.timestamp ?? 0;
    let assigned = false;

    for (const lane of lanes) {
      const laneEnd = Math.max(...lane.entries.map(resolveEntryEnd));
      if (entryStart >= laneEnd) {
        lane.entries.push(entry);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      lanes.push({ entries: [entry] });
    }
  }

  return lanes;
}

export function buildTaskTimelineModel(
  tasks: TaskNode[],
  range: TimelineRange,
  options: { showPending: boolean } = { showPending: false },
): TaskTimelineModel {
  const scaleRange = resolveTimeRange(range, Date.now());
  const timelineEnd = Date.now();
  const entries: TaskTimelineEntry[] = [];

  for (const task of tasks) {
    const timeline = buildTimelineFromStatusTransitions(task, timelineEnd);
    const visibleSegments = options.showPending
      ? timeline.segments
      : timeline.segments.filter((segment) => segment.status !== "pending");

    if (visibleSegments.length === 0 && !timeline.terminalMarker) {
      continue;
    }

    entries.push({
      taskId: task.id,
      taskTitle: task.title,
      currentStatus: resolveEntryCurrentStatus(task, timeline),
      segments: visibleSegments,
      terminalMarker: timeline.terminalMarker,
    });
  }

  return {
    lanes: assignLanes(entries),
    timeRange: resolveModelTimeRange(entries, scaleRange),
    entries,
  };
}
