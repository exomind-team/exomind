import type { TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

export interface TimeBlockDetailSummary {
  title: string;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  feedback?: string;
}

export interface TimeBlockDetailLinkedTask {
  taskId: string;
  title: string;
  outcome?: string;
}

export interface TimeBlockDetailAssociationItem {
  id: string;
  taskId: string;
  title: string;
  action: string;
  source: string;
  timestampLabel: string;
}

export interface TimeBlockDetailView {
  summary: TimeBlockDetailSummary;
  linkedTasks: TimeBlockDetailLinkedTask[];
  associationTimeline: TimeBlockDetailAssociationItem[];
}

export interface BuildTimeBlockDetailViewInput {
  block: TimeBlock;
  tasksById: Map<string, TaskNode>;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(startTime: number, endTime: number): string {
  const totalMinutes = Math.max(0, Math.round((endTime - startTime) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function buildTimeBlockDetailView(input: BuildTimeBlockDetailViewInput): TimeBlockDetailView {
  const { block, tasksById } = input;

  return {
    summary: {
      title: block.name,
      startLabel: formatDateTime(block.startTime),
      endLabel: formatDateTime(block.endTime),
      durationLabel: formatDuration(block.startTime, block.endTime),
      feedback: block.note,
    },
    linkedTasks: (block.taskIds ?? []).map((taskId) => ({
      taskId,
      title: tasksById.get(taskId)?.title ?? taskId,
      outcome: block.taskStatusOutcomes?.[taskId],
    })),
    associationTimeline: [...(block.taskAssociationLog ?? [])]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((item) => ({
        id: `${item.taskId}-${item.action}-${item.timestamp}`,
        taskId: item.taskId,
        title: tasksById.get(item.taskId)?.title ?? item.taskId,
        action: item.action,
        source: item.source,
        timestampLabel: formatDateTime(item.timestamp),
      })),
  };
}
