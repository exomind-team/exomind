import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

export type TimeblockBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface TimeblockBadge {
  label: string;
  tone: TimeblockBadgeTone;
}

export interface TimeblockSummaryMetric {
  key: 'start' | 'end' | 'duration' | 'expected' | 'event_count' | 'blockCount';
  label: string;
  value: string;
}

export interface TimeblockSummary {
  blockName: string;
  badges: TimeblockBadge[];
  taskLinkLabel: string;
  metrics: TimeblockSummaryMetric[];
}

export interface TimeblockAnchorItem {
  id: 'overview' | 'timeline' | 'ai-summary' | 'actions';
  label: string;
  active?: boolean;
}

export interface TimeblockPlanActual {
  planContent: string;
  actualContent: string;
  diffReason: string;
}

export type TimeblockEventTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface TimeblockTimelineEvent {
  id: string;
  title: string;
  timeLabel: string;
  description: string;
  tone: TimeblockEventTone;
}

export interface TimeblockTimeline {
  sectionTitle: string;
  items: TimeblockTimelineEvent[];
}

export interface TimeblockAiSummary {
  title: string;
  summaryText: string;
  keyOutput: string;
  blocker: string;
  suggestion: string;
}

export interface TimeblockActionItem {
  id: 'open-task' | 'copy-summary';
  label: string;
  to?: string;
  search?: Record<string, string>;
}

export interface TimeblockEventLog {
  id: string;
  createdAt: string;
  content: string;
  type?: string;
}

export interface LinkedBlockItem {
  startId: string;
  name: string;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  isActive: boolean;
}

export interface TaskTimeblockDetailViewModel {
  summary: TimeblockSummary;
  anchors: TimeblockAnchorItem[];
  planActual: TimeblockPlanActual;
  timeline: TimeblockTimeline;
  aiSummary: TimeblockAiSummary;
  actions: TimeblockActionItem[];
  linkedBlocks: LinkedBlockItem[];
}

export interface BuildTaskTimeblockDetailViewModelInput {
  task: TaskNode;
  blocks: TimeBlock[];
  activeBlock?: ActiveBlockData | null;
  preferredBlockId?: string;
  eventLogs?: TimeblockEventLog[];
  reviewMarkdown?: string;
  useMockData?: boolean;
  now?: Date;
}

const STATUS_BADGE_LABEL: Record<TaskNode['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}-${day} ${formatClock(timestamp)}`;
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  if (hours > 0 && remain > 0) return `${hours}h ${remain}m`;
  if (hours > 0) return `${hours}h`;
  return `${remain}m`;
}

function resolveBlockForTask(
  task: TaskNode,
  blocks: TimeBlock[],
  activeBlock: ActiveBlockData | null | undefined,
  preferredBlockId: string | undefined,
  nowTs: number,
): TimeBlock | null {
  if (preferredBlockId) {
    const preferred = blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId);
    if (preferred) return preferred;
  }

  const taskBlockIds = new Set((task.timeBlockIds ?? []).map((value) => value.trim()).filter(Boolean));
  const linkedBlocks = blocks.filter((block) => taskBlockIds.has(block.startId) || taskBlockIds.has(block.id));
  const sortedLinkedBlocks = linkedBlocks.sort((left, right) => right.endTime - left.endTime);
  const latestLinked = sortedLinkedBlocks[0];
  if (latestLinked) return latestLinked;

  if (activeBlock && activeBlock.taskId === task.id) {
    return {
      id: activeBlock.startId,
      startId: activeBlock.startId,
      endId: `${activeBlock.startId}-active`,
      name: activeBlock.name,
      note: '当前时间块进行中',
      tags: new Set(['block_feedback']),
      startTime: activeBlock.startTime,
      endTime: nowTs,
    };
  }

  return null;
}

function resolveDurationMinutes(block: TimeBlock | null): number {
  if (!block) return 0;
  return Math.max(0, Math.round((block.endTime - block.startTime) / 60_000));
}

function resolveScheduleBadge(estimatedMinutes: number | undefined, actualMinutes: number): TimeblockBadge | null {
  if (!estimatedMinutes || estimatedMinutes <= 0) return null;
  const delta = estimatedMinutes - actualMinutes;
  if (delta > 0) return { label: `提前${delta}分钟`, tone: 'success' };
  if (delta < 0) return { label: `超出${Math.abs(delta)}分钟`, tone: 'warning' };
  return { label: '准时完成', tone: 'neutral' };
}

function hasBlockerHint(text: string | undefined): boolean {
  if (!text) return false;
  return /(阻塞|冲突|问题|bug|报错|失败)/i.test(text);
}

function extractAiValue(markdown: string, keys: string[]): string {
  for (const key of keys) {
    const reg = new RegExp(`\\*\\*${key}\\*\\*\\s*([^\\n]+)`, 'i');
    const match = markdown.match(reg);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function buildAiSummary(taskTitle: string, reviewMarkdown: string | undefined): TimeblockAiSummary {
  if (!reviewMarkdown || reviewMarkdown.trim().length === 0) {
    return {
      title: `AI 总结：${taskTitle}`,
      summaryText: '暂无 AI 自动总结，完成时间块后会自动生成。',
      keyOutput: '暂无',
      blocker: '暂无',
      suggestion: '完成本次时间块后可查看 AI 反馈。',
    };
  }

  const keyOutput = extractAiValue(reviewMarkdown, ['做得好的', '有效产出']);
  const blocker = extractAiValue(reviewMarkdown, ['卡住的地方', '阻塞点']);
  const suggestion = extractAiValue(reviewMarkdown, ['建议', '改进建议']);

  return {
    title: `AI 总结：${taskTitle}`,
    summaryText: keyOutput || blocker || suggestion || 'AI 已生成总结。',
    keyOutput: keyOutput || '暂无',
    blocker: blocker || '暂无',
    suggestion: suggestion || '暂无',
  };
}

function buildMockTimeline(block: TimeBlock, aiSummary: TimeblockAiSummary, nowTs: number): TimeblockTimeline {
  const durationMs = Math.max(0, block.endTime - block.startTime);
  const slice = Math.max(5 * 60_000, Math.floor(durationMs / 5));
  const blocker = hasBlockerHint(block.note);

  const startTs = block.startTime;
  const t2 = Math.min(block.endTime, startTs + slice);
  const t3 = Math.min(block.endTime, startTs + slice * 2);
  const t4 = Math.min(block.endTime, startTs + slice * 3);
  const t5 = Math.min(block.endTime, startTs + slice * 4);
  const endTs = block.endTime;

  const items: TimeblockTimelineEvent[] = [
    {
      id: 'event-start',
      title: '开始时间块',
      timeLabel: formatDateTime(startTs),
      description: `开始专注：${block.name}`,
      tone: 'success',
    },
    {
      id: 'event-setup',
      title: '建立基础结构',
      timeLabel: formatDateTime(t2),
      description: '完成主要结构搭建并进入主流程。',
      tone: 'neutral',
    },
    {
      id: 'event-blocker',
      title: blocker ? '依赖冲突（阻塞）' : '持续推进',
      timeLabel: formatDateTime(t3),
      description: blocker ? (block.note ?? '执行过程中遇到阻塞。') : '未出现明显阻塞，持续推进中。',
      tone: blocker ? 'danger' : 'neutral',
    },
    {
      id: 'event-resume',
      title: blocker ? '恢复编码' : '继续执行',
      timeLabel: formatDateTime(t4),
      description: blocker ? '完成阻塞处理，恢复主线编码。' : '继续按计划推进。',
      tone: blocker ? 'warning' : 'neutral',
    },
    {
      id: 'event-main-flow',
      title: '主流程跑通',
      timeLabel: formatDateTime(t5),
      description: '关键流程可用，进入收尾验证。',
      tone: 'success',
    },
    {
      id: 'event-end',
      title: '结束时间块',
      timeLabel: formatDateTime(endTs),
      description: '时间块已结束，输出已沉淀。',
      tone: 'success',
    },
  ];

  if (aiSummary.summaryText !== '暂无 AI 自动总结，完成时间块后会自动生成。') {
    items.push({
      id: 'event-ai',
      title: 'AI 反馈',
      timeLabel: formatDateTime(Math.max(endTs, nowTs)),
      description: aiSummary.summaryText,
      tone: 'neutral',
    });
  }

  return {
    sectionTitle: '事件时间线',
    items,
  };
}

function parseEventTimestamp(createdAt: string): number | null {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveEventTitle(type: string | undefined): string {
  if (type === 'block_start') return '开始时间块';
  if (type === 'block_pause') return '暂停时间块';
  if (type === 'block_resume') return '恢复时间块';
  if (type === 'block_end') return '结束时间块';
  if (type === 'agent_feedback') return 'AI 反馈';
  if (type === 'block_feedback') return '时间块反馈';
  return '事件记录';
}

function resolveEventTone(type: string | undefined): TimeblockEventTone {
  if (type === 'block_start' || type === 'block_resume' || type === 'block_end') return 'success';
  if (type === 'block_pause' || type === 'block_feedback') return 'warning';
  if (type === 'error') return 'danger';
  return 'neutral';
}

type TimeRange = { startTime: number; endTime: number };

function buildRealTimeline(ranges: TimeRange[], eventLogs: TimeblockEventLog[]): TimeblockTimeline {
  if (ranges.length === 0) {
    return {
      sectionTitle: '事件时间线',
      items: [],
    };
  }

  const items = eventLogs
    .map((event) => {
      const timestamp = parseEventTimestamp(event.createdAt);
      if (timestamp === null) return null;
      if (!ranges.some((range) => timestamp >= range.startTime && timestamp <= range.endTime)) return null;

      return {
        id: event.id,
        timestamp,
        item: {
          id: event.id,
          title: resolveEventTitle(event.type),
          timeLabel: formatDateTime(timestamp),
          description: event.content.trim() || '（空事件内容）',
          tone: resolveEventTone(event.type),
        } satisfies TimeblockTimelineEvent,
      };
    })
    .filter((value): value is { id: string; timestamp: number; item: TimeblockTimelineEvent } => value !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((value) => value.item);

  if (items.length === 0) {
    return {
      sectionTitle: '事件时间线',
      items: [
        {
          id: 'timeline-empty',
          title: '暂无事件记录',
          timeLabel: '—',
          description: '该时间块范围内未检索到事件日志。',
          tone: 'neutral',
        },
      ],
    };
  }

  return {
    sectionTitle: '事件时间线',
    items,
  };
}

function buildPlanActual(task: TaskNode, block: TimeBlock | null, scheduleBadge: TimeblockBadge | null): TimeblockPlanActual {
  const planDuration = task.estimatedMinutes ? `（预计 ${formatMinutes(task.estimatedMinutes)}）` : '';
  const actualDuration = resolveDurationMinutes(block);
  const diffReason = block
    ? scheduleBadge
      ? `与计划对比：${scheduleBadge.label}。`
      : hasBlockerHint(block.note)
        ? '执行中出现阻塞，已在时间块内处理并恢复。'
        : '执行与计划基本一致。'
    : '开始时间块后可生成实际记录。';

  return {
    planContent: `计划：${task.title}${planDuration}`,
    actualContent: block ? `实际：${block.name}（耗时 ${formatMinutes(actualDuration)}）` : '实际：暂无时间块记录',
    diffReason,
  };
}

export function buildTaskTimeblockDetailViewModel(input: BuildTaskTimeblockDetailViewModelInput): TaskTimeblockDetailViewModel {
  const nowTs = input.now ? input.now.getTime() : Date.now();
  const useMockData = input.useMockData === true;
  const block = resolveBlockForTask(
    input.task,
    input.blocks,
    input.activeBlock ?? null,
    input.preferredBlockId,
    nowTs,
  );
  const actualMinutes = resolveDurationMinutes(block);
  const scheduleBadge = block ? resolveScheduleBadge(input.task.estimatedMinutes, actualMinutes) : null;
  const statusBadge: TimeblockBadge = {
    label: STATUS_BADGE_LABEL[input.task.status],
    tone: input.task.status === 'completed' ? 'success' : input.task.status === 'cancelled' ? 'danger' : 'neutral',
  };
  const summaryBlockName = block?.name ?? input.task.title;
  const aiSummary = buildAiSummary(summaryBlockName, input.reviewMarkdown);

  const taskBlockIds = new Set((input.task.timeBlockIds ?? []).map((v) => v.trim()).filter(Boolean));
  const completedLinked = input.blocks
    .filter((b) => taskBlockIds.has(b.startId) || taskBlockIds.has(b.id))
    .sort((a, b) => b.endTime - a.endTime);
  const timelineRanges: TimeRange[] = completedLinked.map((linked) => ({
    startTime: linked.startTime,
    endTime: linked.endTime,
  }));
  if (input.activeBlock && input.activeBlock.taskId === input.task.id) {
    timelineRanges.push({ startTime: input.activeBlock.startTime, endTime: nowTs });
  }

  const mockBlock: TimeBlock = block ?? {
    id: `task-${input.task.id}-mock`,
    startId: `task-${input.task.id}-mock`,
    endId: `task-${input.task.id}-mock`,
    name: summaryBlockName,
    note: input.task.description,
    tags: new Set(['block_feedback']),
    startTime: nowTs,
    endTime: nowTs,
  };
  const timeline = useMockData
    ? timelineRanges.length > 0
      ? buildMockTimeline(mockBlock, aiSummary, nowTs)
      : { sectionTitle: '事件时间线', items: [] }
    : buildRealTimeline(timelineRanges, input.eventLogs ?? []);

  const badges = scheduleBadge ? [statusBadge, scheduleBadge] : [statusBadge];
  const blockCount = completedLinked.length;

  const linkedBlocks: LinkedBlockItem[] = completedLinked.map((b) => ({
    startId: b.startId,
    name: b.name,
    startLabel: formatDateTime(b.startTime),
    endLabel: formatDateTime(b.endTime),
    durationLabel: formatMinutes(resolveDurationMinutes(b)),
    isActive: false,
  }));

  if (input.activeBlock && input.activeBlock.taskId === input.task.id) {
    const ab = input.activeBlock;
    linkedBlocks.unshift({
      startId: ab.startId,
      name: ab.name,
      startLabel: formatDateTime(ab.startTime),
      endLabel: '进行中',
      durationLabel: formatMinutes(Math.max(0, Math.round((nowTs - ab.startTime) / 60_000))),
      isActive: true,
    });
  }

  const metrics: TimeblockSummaryMetric[] = [
    { key: 'start', label: '开始', value: block ? formatClock(block.startTime) : '—' },
    { key: 'end', label: '结束', value: block ? formatClock(block.endTime) : '—' },
    { key: 'expected', label: '预期', value: input.task.estimatedMinutes ? formatMinutes(input.task.estimatedMinutes) : '正计时' },
    { key: 'duration', label: '时长', value: formatMinutes(actualMinutes) },
    { key: 'event_count', label: '事件数', value: `${timeline.items.length}` },
    { key: 'blockCount', label: '时间块数', value: String(blockCount) },
  ];
  const actions: TimeblockActionItem[] = [
    { id: 'open-task', label: '查看关联任务', to: `/tasks/${input.task.id}` },
    { id: 'copy-summary', label: '复制总结' },
  ];

  return {
    summary: {
      blockName: summaryBlockName,
      badges,
      taskLinkLabel: input.task.title,
      metrics,
    },
    anchors: [
      { id: 'overview', label: '概览', active: true },
      { id: 'timeline', label: '时间线' },
      { id: 'ai-summary', label: 'AI 总结' },
      { id: 'actions', label: '操作' },
    ],
    planActual: buildPlanActual(input.task, block, scheduleBadge),
    timeline,
    aiSummary,
    actions,
    linkedBlocks,
  };
}
