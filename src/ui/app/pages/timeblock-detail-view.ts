import { resolveTimeBlockRelatedTaskIds, type TimeBlock } from '@/lib/types/event';
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
  description: string;
  action: string;
  actionLabel: string;
  source: string;
  sourceLabel: string;
  timestampLabel: string;
  tone: 'neutral' | 'success' | 'warning';
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

function resolveAssociationActionLabel(action: string): string {
  if (action === 'associated') return '关联任务';
  if (action === 'disassociated') return '移除关联任务';
  return action;
}

function resolveAssociationSourceLabel(source: string): string {
  if (source === 'block_start') return '时间块启动';
  if (source === 'manual') return '手动调整';
  if (source === 'block_end') return '结束时间块';
  return source;
}

function resolveAssociationTone(action: string): 'neutral' | 'success' | 'warning' {
  if (action === 'associated') return 'success';
  if (action === 'disassociated') return 'warning';
  return 'neutral';
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
  const taskIds = resolveTimeBlockRelatedTaskIds(block);

  return {
    summary: {
      title: block.name,
      startLabel: formatDateTime(block.startTime),
      endLabel: formatDateTime(block.endTime),
      durationLabel: formatDuration(block.startTime, block.endTime),
      feedback: block.note,
    },
    linkedTasks: taskIds.map((taskId) => ({
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
        description: `${resolveAssociationActionLabel(item.action)} · ${resolveAssociationSourceLabel(item.source)}`,
        action: item.action,
        actionLabel: resolveAssociationActionLabel(item.action),
        source: item.source,
        sourceLabel: resolveAssociationSourceLabel(item.source),
        timestampLabel: formatDateTime(item.timestamp),
        tone: resolveAssociationTone(item.action),
      })),
  };
}
