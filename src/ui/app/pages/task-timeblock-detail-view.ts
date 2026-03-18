import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

export type TimeblockBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface TimeblockBadge {
  label: string;
  tone: TimeblockBadgeTone;
}

export interface TimeblockSummaryMetric {
  key: 'start' | 'end' | 'duration' | 'expected' | 'event_count';
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
  id: 'back-source' | 'open-task' | 'open-eventlog' | 'restart' | 'copy-summary';
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

export interface TaskTimeblockDetailViewModel {
  summary: TimeblockSummary;
  anchors: TimeblockAnchorItem[];
  planActual: TimeblockPlanActual;
  timeline: TimeblockTimeline;
  aiSummary: TimeblockAiSummary;
  actions: TimeblockActionItem[];
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
  backAction?: {
    label: string;
    to: string;
    search?: Record<string, string>;
  };
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
): TimeBlock {
  if (preferredBlockId) {
    const preferred = blocks.find((block) => block.id === preferredBlockId || block.startId === preferredBlockId);
    if (preferred) return preferred;
  }

  const taskBlockIds = new Set((task.timeBlockIds ?? []).map((value) => value.trim()));
  const linkedBlocks = blocks.filter((block) => taskBlockIds.has(block.startId) || taskBlockIds.has(block.id));
  const sortedLinkedBlocks = linkedBlocks.sort((left, right) => right.endTime - left.endTime);
  const latestLinked = sortedLinkedBlocks[0];
  if (latestLinked) return latestLinked;

  const activeTaskIds = activeBlock?.taskIds ?? [];
  const isLinkedActiveBlock = activeBlock
    ? activeTaskIds.includes(task.id) || activeBlock.taskId === task.id
    : false;

  if (activeBlock && isLinkedActiveBlock) {
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

  const fallbackTs = task.updatedAt || nowTs;
  return {
    id: `task-${task.id}-fallback`,
    startId: `task-${task.id}-fallback`,
    endId: `task-${task.id}-fallback-end`,
    name: task.title,
    note: task.description,
    tags: new Set(['block_feedback']),
    startTime: fallbackTs,
    endTime: fallbackTs,
  };
}

function resolveDurationMinutes(block: TimeBlock): number {
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

function buildRealTimeline(block: TimeBlock, eventLogs: TimeblockEventLog[]): TimeblockTimeline {
  const items = eventLogs
    .map((event) => {
      const timestamp = parseEventTimestamp(event.createdAt);
      if (timestamp === null) return null;
      if (timestamp < block.startTime || timestamp > block.endTime) return null;

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
          id: `${block.startId}-empty`,
          title: '暂无事件记录',
          timeLabel: formatDateTime(block.startTime),
          description: '该时间块范围内未检索到 EventLog 事件。',
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

function buildPlanActual(task: TaskNode, block: TimeBlock, scheduleBadge: TimeblockBadge | null): TimeblockPlanActual {
  const planDuration = task.estimatedMinutes ? `（预计 ${formatMinutes(task.estimatedMinutes)}）` : '';
  const actualDuration = resolveDurationMinutes(block);
  const diffReason = scheduleBadge
    ? `与计划对比：${scheduleBadge.label}。`
    : hasBlockerHint(block.note)
      ? '执行中出现阻塞，已在时间块内处理并恢复。'
      : '执行与计划基本一致。';

  return {
    planContent: `计划：${task.title}${planDuration}`,
    actualContent: `实际：${block.name}（耗时 ${formatMinutes(actualDuration)}）${block.note ? `；备注：${block.note}` : ''}`,
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
  const scheduleBadge = resolveScheduleBadge(input.task.estimatedMinutes, actualMinutes);
  const statusBadge: TimeblockBadge = {
    label: STATUS_BADGE_LABEL[input.task.status],
    tone: input.task.status === 'completed' ? 'success' : input.task.status === 'cancelled' ? 'danger' : 'neutral',
  };
  const aiSummary = buildAiSummary(block.name, input.reviewMarkdown);
  const timeline = useMockData
    ? buildMockTimeline(block, aiSummary, nowTs)
    : buildRealTimeline(block, input.eventLogs ?? []);

  const badges = scheduleBadge ? [statusBadge, scheduleBadge] : [statusBadge];
  const metrics: TimeblockSummaryMetric[] = [
    { key: 'start', label: '开始', value: formatClock(block.startTime) },
    { key: 'end', label: '结束', value: formatClock(block.endTime) },
    { key: 'duration', label: '时长', value: formatMinutes(actualMinutes) },
    { key: 'expected', label: '预期', value: input.task.estimatedMinutes ? formatMinutes(input.task.estimatedMinutes) : '未估时' },
    { key: 'event_count', label: '事件数', value: `${timeline.items.length}` },
  ];
  const actions: TimeblockActionItem[] = [
    ...(input.backAction
      ? [{ id: 'back-source', label: input.backAction.label, to: input.backAction.to, search: input.backAction.search } as const]
      : []),
    { id: 'open-task', label: '查看关联任务', to: `/tasks/${input.task.id}` },
    { id: 'open-eventlog', label: '打开 EventLog', to: '/eventlog' },
    { id: 'restart', label: '再来一个时间块' },
    { id: 'copy-summary', label: '复制总结' },
  ];

  return {
    summary: {
      blockName: block.name,
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
  };
}
