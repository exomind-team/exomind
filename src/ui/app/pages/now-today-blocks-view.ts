import { resolveActiveBlockTaskIds, type TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

export interface NowTodayLinkedTask {
  taskId: string;
  title: string;
  outcome?: string;
}

export interface NowTodayBlockItem {
  blockId: string;
  title: string;
  timeLabel: string;
  linkedTasks: NowTodayLinkedTask[];
  href: string;
  note?: string;
}

export interface NowTodayBlocksView {
  items: NowTodayBlockItem[];
}

export interface BuildNowTodayBlocksViewInput {
  blocks: TimeBlock[];
  tasksById: Map<string, TaskNode>;
  now: Date;
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildLinkedTasks(block: TimeBlock, tasksById: Map<string, TaskNode>): NowTodayLinkedTask[] {
  return resolveActiveBlockTaskIds(block).map((taskId) => ({
    taskId,
    title: tasksById.get(taskId)?.title ?? taskId,
    outcome: block.taskStatusOutcomes?.[taskId],
  }));
}

export function buildNowTodayBlocksView(input: BuildNowTodayBlocksViewInput): NowTodayBlocksView {
  const dayStart = startOfDay(input.now);
  const dayEnd = dayStart + 86_400_000;

  const items = input.blocks
    .filter((block) => block.startTime >= dayStart && block.startTime < dayEnd)
    .sort((left, right) => right.startTime - left.startTime)
    .map((block) => ({
      blockId: block.id,
      title: block.name,
      timeLabel: `${formatClock(block.startTime)} - ${formatClock(block.endTime)}`,
      linkedTasks: buildLinkedTasks(block, input.tasksById),
      href: `/tasks/block/${block.id}`,
      note: block.note,
    }));

  return { items };
}
