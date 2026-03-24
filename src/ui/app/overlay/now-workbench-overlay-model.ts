import type { ActiveBlockData, Event } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { filterNow } from '@/ui/app/pages/task-tab-filters';

export type NowWorkbenchOverlayMode = 'running' | 'idle_with_tasks' | 'idle_input_only';

export interface NowWorkbenchOverlayNudge {
  kind: 'status_check' | 'shutdown_ready';
  title: string;
  body: string;
  ctaLabel: string;
}

export interface NowWorkbenchOverlayRecentEvent {
  id: string;
  content: string;
  timestamp: number;
}

export interface NowWorkbenchOverlayModel {
  mode: NowWorkbenchOverlayMode;
  title: string;
  statusLabel: string;
  activeBlock: ActiveBlockData | null;
  visibleTasks: TaskNode[];
  recentEvents: NowWorkbenchOverlayRecentEvent[];
  nudge?: NowWorkbenchOverlayNudge;
}

export interface BuildNowWorkbenchOverlayModelInput {
  activeBlock: ActiveBlockData | null;
  tasks: TaskNode[];
  events: Event[];
  now: number;
  ritual?: {
    stage?: string;
  };
}

function resolveRunningStatusLabel(block: ActiveBlockData): string {
  if (block.feedbackSubmittedAt) {
    return '已完成';
  }
  if (
    block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt)
  ) {
    return '待反馈';
  }
  if (block.paused || block.phase === 'paused') {
    return '已暂停';
  }
  return '进行中';
}

function summarizeRecentEvents(events: Event[]): NowWorkbenchOverlayRecentEvent[] {
  return [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 2)
    .map((event) => ({
      id: event.id,
      content: event.content,
      timestamp: event.timestamp,
    }));
}

export function buildNowWorkbenchOverlayModel(
  input: BuildNowWorkbenchOverlayModelInput,
): NowWorkbenchOverlayModel {
  const visibleTasks = filterNow(input.tasks);
  const recentEvents = summarizeRecentEvents(input.events);
  const nudge = input.ritual?.stage === 'shutdown_ready'
    ? {
      kind: 'shutdown_ready' as const,
      title: '准备收工',
      body: '今天已经可以先收住了，回主程序完成正式收工。',
      ctaLabel: '回主程序收工',
    }
    : undefined;

  if (input.activeBlock) {
    return {
      mode: 'running',
      title: input.activeBlock.name || '未命名任务',
      statusLabel: resolveRunningStatusLabel(input.activeBlock),
      activeBlock: input.activeBlock,
      visibleTasks,
      recentEvents,
      nudge,
    };
  }

  if (visibleTasks.length > 0) {
    return {
      mode: 'idle_with_tasks',
      title: visibleTasks[0]?.title || '当下工作台',
      statusLabel: '待办',
      activeBlock: null,
      visibleTasks,
      recentEvents,
      nudge,
    };
  }

  return {
    mode: 'idle_input_only',
    title: '当下工作台',
    statusLabel: '随时记录',
    activeBlock: null,
    visibleTasks: [],
    recentEvents,
    nudge,
  };
}
