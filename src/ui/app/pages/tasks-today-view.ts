import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

export type TodayTimelineBucketId = 'morning' | 'noon' | 'afternoon' | 'night';

export interface TodayTimelineItem {
  id: string;
  blockId: string;
  taskId?: string;
  title: string;
  bucketId: TodayTimelineBucketId;
  bucketLabel: string;
  tagLabel: string;
  tone: 'green' | 'orange' | 'blue' | 'red' | 'stone';
  timeLabel: string;
  meta: string;
  planText?: string;
  actualText: string;
  note?: string;
}

export interface TodayTimelineSection {
  id: TodayTimelineBucketId;
  label: string;
  rangeLabel: string;
  durationLabel: string;
  items: TodayTimelineItem[];
}

export interface TasksTodayViewModel {
  inProgressTasks: TaskNode[];
  inProgressCount: number;
  timelineSections: TodayTimelineSection[];
  todayBlockCount: number;
}

interface BuildTasksTodayViewModelInput {
  tasks: TaskNode[];
  blocks: TimeBlock[];
  now: Date;
  activeBlock: ActiveBlockData | null;
}

const SECTION_SPECS: Array<{
  id: TodayTimelineBucketId;
  label: string;
  rangeLabel: string;
  durationLabel: string;
  startHour: number;
  endHour: number;
}> = [
  { id: 'morning', label: '上午', rangeLabel: '06:00 - 12:00', durationLabel: '6h', startHour: 6, endHour: 12 },
  { id: 'noon', label: '中午', rangeLabel: '12:00 - 14:00', durationLabel: '2h', startHour: 12, endHour: 14 },
  { id: 'afternoon', label: '下午', rangeLabel: '14:00 - 18:00', durationLabel: '4h', startHour: 14, endHour: 18 },
  { id: 'night', label: '晚上', rangeLabel: '18:00 - 24:00', durationLabel: '6h', startHour: 18, endHour: 24 },
];

function getTodayRange(now: Date): { start: number; end: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 86_400_000 };
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDurationMinutes(minutes?: number): string {
  if (!minutes) {
    return '未估时';
  }
  if (minutes % 60 === 0) {
    return `预计 ${minutes / 60}h`;
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remain = minutes % 60;
    return `预计 ${hours}h ${remain}min`;
  }
  return `预计 ${minutes}min`;
}

function resolveBucketId(startTime: number): TodayTimelineBucketId {
  const hour = new Date(startTime).getHours();
  if (hour >= 12 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18) return 'night';
  return 'morning';
}

function resolveTone(task: TaskNode | undefined, block: TimeBlock): TodayTimelineItem['tone'] {
  const tagPool = new Set<string>([
    ...(task?.tags ?? []),
    ...Array.from(block.tags),
    block.name,
  ].map((value) => value.toLowerCase()));

  if (tagPool.has('study') || tagPool.has('学习')) return 'blue';
  if (tagPool.has('life') || tagPool.has('生活') || tagPool.has('rest') || tagPool.has('休息')) return 'green';
  if (block.note?.includes('问题') || block.note?.includes('bug') || block.note?.includes('冲突')) return 'red';
  if (task?.status === 'in_progress') return 'orange';
  return 'stone';
}

function resolveTagLabel(task: TaskNode | undefined, block: TimeBlock): string {
  if (task?.tags?.[0]) return task.tags[0];
  const blockName = block.name.toLowerCase();
  if (blockName.includes('学') || blockName.includes('read')) return '学习';
  if (blockName.includes('跑') || blockName.includes('午') || blockName.includes('餐') || blockName.includes('休')) return '生活';
  if (blockName.includes('bug') || blockName.includes('调试') || blockName.includes('修复')) return '问题';
  return '专注';
}

function buildTaskLookup(tasks: TaskNode[]): Map<string, TaskNode> {
  const lookup = new Map<string, TaskNode>();
  for (const task of tasks) {
    for (const blockId of task.timeBlockIds ?? []) {
      lookup.set(blockId, task);
    }
  }
  return lookup;
}

export function buildTasksTodayViewModel(input: BuildTasksTodayViewModelInput): TasksTodayViewModel {
  const { tasks, blocks, now, activeBlock } = input;
  const todayRange = getTodayRange(now);
  const taskLookup = buildTaskLookup(tasks);
  const inProgressTasks = tasks.filter((task) => task.status === 'in_progress');
  const todayBlocks = blocks
    .filter((block) => block.startTime >= todayRange.start && block.startTime < todayRange.end)
    .sort((left, right) => left.startTime - right.startTime);

  const sectionItems = new Map<TodayTimelineBucketId, TodayTimelineItem[]>();
  for (const spec of SECTION_SPECS) {
    sectionItems.set(spec.id, []);
  }

  for (const block of todayBlocks) {
    const task = taskLookup.get(block.id) ?? taskLookup.get(block.startId);
    const bucketId = resolveBucketId(block.startTime);
    const bucketSpec = SECTION_SPECS.find((section) => section.id === bucketId)!;
    const actualText = task?.title ?? block.name;
    const planText = task && block.name !== task.title ? block.name : undefined;

    sectionItems.get(bucketId)!.push({
      id: block.id,
      blockId: block.id,
      taskId: task?.id,
      title: actualText,
      bucketId,
      bucketLabel: bucketSpec.label,
      tagLabel: resolveTagLabel(task, block),
      tone: resolveTone(task, block),
      timeLabel: `${formatClock(block.startTime)} - ${formatClock(block.endTime)}`,
      meta: formatDurationMinutes(task?.estimatedMinutes),
      actualText,
      planText,
      note: block.note,
    });
  }

  if (activeBlock && activeBlock.startTime >= todayRange.start && activeBlock.startTime < todayRange.end) {
    const task = activeBlock.taskId ? tasks.find((item) => item.id === activeBlock.taskId) : undefined;
    const bucketId = resolveBucketId(activeBlock.startTime);
    const bucketSpec = SECTION_SPECS.find((section) => section.id === bucketId)!;
    sectionItems.get(bucketId)!.push({
      id: `active-${activeBlock.startId}`,
      blockId: activeBlock.startId,
      taskId: activeBlock.taskId,
      title: task?.title ?? activeBlock.name,
      bucketId,
      bucketLabel: bucketSpec.label,
      tagLabel: task?.tags?.[0] ?? '进行中',
      tone: 'orange',
      timeLabel: `${formatClock(activeBlock.startTime)} - 进行中`,
      meta: formatDurationMinutes(task?.estimatedMinutes),
      actualText: task?.title ?? activeBlock.name,
      planText: task && activeBlock.name !== task.title ? activeBlock.name : undefined,
      note: '当前时间块进行中',
    });
  }

  const timelineSections = SECTION_SPECS
    .map((spec) => ({
      id: spec.id,
      label: spec.label,
      rangeLabel: spec.rangeLabel,
      durationLabel: spec.durationLabel,
      items: sectionItems.get(spec.id) ?? [],
    }))
    .filter((section) => section.items.length > 0);

  return {
    inProgressTasks,
    inProgressCount: inProgressTasks.length,
    timelineSections,
    todayBlockCount: todayBlocks.length + (activeBlock ? 1 : 0),
  };
}
