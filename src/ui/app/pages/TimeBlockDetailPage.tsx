import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { Waypoints } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { getEventLogService, getTaskService, getTimeBlockService } from '@/lib/services';
import { resolveActiveBlockTaskIds, resolveTimeBlockRelatedTaskIds, type ActiveBlockData, type Event, type TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { buildTimeBlockDetailView } from './timeblock-detail-view';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';

function resolveActiveTaskIds(block: ActiveBlockData): string[] {
  return resolveActiveBlockTaskIds(block);
}

function toneDotClassName(tone: 'neutral' | 'success' | 'warning' | 'danger'): string {
  if (tone === 'success') return 'bg-[#16A34A]';
  if (tone === 'warning') return 'bg-[#C75B3A]';
  if (tone === 'danger') return 'bg-[#E7000B]';
  return 'bg-[#78716C]';
}

function formatTimelineDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function resolveEventTitle(tags: Set<string>): string | null {
  if (tags.has('block_start')) return '开始时间块';
  if (tags.has('block_pause')) return '暂停时间块';
  if (tags.has('block_resume')) return '恢复时间块';
  if (tags.has('block_end')) return '结束时间块';
  if (tags.has('agent_feedback')) return 'AI 反馈';
  if (tags.has('block_feedback')) return '时间块反馈';
  if (tags.has('error')) return '异常记录';
  return null;
}

function resolveEventTone(tags: Set<string>): 'neutral' | 'success' | 'warning' | 'danger' {
  if (tags.has('block_start') || tags.has('block_resume') || tags.has('block_end')) return 'success';
  if (tags.has('block_pause') || tags.has('block_feedback')) return 'warning';
  if (tags.has('error')) return 'danger';
  return 'neutral';
}

function buildRunningTimeBlock(block: ActiveBlockData, now: number): TimeBlock {
  return {
    id: block.startId,
    startId: block.startId,
    endId: `${block.startId}-active`,
    name: block.name,
    note: '进行中',
    tags: new Set(['block_feedback']),
    startTime: block.startTime,
    endTime: now,
    taskIds: resolveActiveTaskIds(block),
    taskAssociationLog: block.taskAssociationLog ?? [],
  };
}

export function TimeBlockDetailPage() {
  const { blockId } = useParams({ strict: false }) as { blockId?: string };
  const location = useLocation();
  const navigate = useNavigate();
  const [block, setBlock] = useState<TimeBlock | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [eventLogs, setEventLogs] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const isNowDomain = location.pathname.startsWith('/eventlog/');
  const backLink = isNowDomain
    ? { label: '当下', to: '/eventlog' }
    : { label: '任务', to: '/tasks' };
  const returnTo = block
    ? (isNowDomain ? `/eventlog/timeblocks/${block.startId}` : `/tasks/block/${block.startId}`)
    : undefined;

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      const timeBlockService = getTimeBlockService();
      const taskService = getTaskService();
      const [blocks, activeBlock, events] = await Promise.all([
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
        getEventLogService().loadEvents(),
      ]);

      let matchedBlock = blocks.find((item) => item.id === blockId || item.startId === blockId) ?? null;
      if (!matchedBlock && activeBlock && activeBlock.startId === blockId) {
        matchedBlock = buildRunningTimeBlock(activeBlock, Date.now());
      }

      const taskIds = matchedBlock ? resolveTimeBlockRelatedTaskIds(matchedBlock) : [];
      const tasks = await Promise.all(taskIds.map((taskId) => taskService.getTask(taskId)));

      if (disposed) return;
      setBlock(matchedBlock);
      setTasksById(new Map(tasks.filter((task): task is TaskNode => Boolean(task)).map((task) => [task.id, task])));
      setEventLogs(events);
      setLoading(false);
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [blockId]);

  const view = useMemo(() => (
    block ? buildTimeBlockDetailView({ block, tasksById }) : null
  ), [block, tasksById]);
  const timelineItems = useMemo(() => {
    if (!block) return [];

    return eventLogs
      .filter((event) => event.timestamp >= block.startTime && event.timestamp <= block.endTime)
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((event) => ({
        id: event.id,
        title: resolveEventTitle(event.tags),
        timeLabel: formatTimelineDateTime(event.timestamp),
        description: event.content.trim() || '（空事件内容）',
        tone: resolveEventTone(event.tags),
      }));
  }, [block, eventLogs]);

  if (loading) {
    return <div className="px-6 py-6 text-sm text-[#78716C] dark:text-[#A8A29E]">加载时间块详情...</div>;
  }

  if (!block || !view) {
    return (
      <div className="px-6 py-6">
        <Link to={backLink.to} className="text-sm text-[#78716C] dark:text-[#A8A29E]">← 返回{backLink.label}</Link>
        <p className="mt-4 text-sm text-[#78716C] dark:text-[#A8A29E]">未找到对应时间块。</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
      <header className="sticky top-0 z-10 -mx-6 mb-4 border-b border-[#F0ECE8] bg-[#FAF7F5]/95 px-6 py-4 backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/95">
        <div className="mx-auto max-w-4xl">
          <TaskBreadcrumb
            segments={[backLink]}
            current={{ label: '时间块详情' }}
          />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-4">
        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
          <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{view.summary.title}</h1>
          <div className="mt-3 grid gap-3 text-sm text-[#57534E] dark:text-[#D6D3D1] md:grid-cols-3">
            <div>
              <p className="text-xs text-[#A8A29E]">开始</p>
              <p>{view.summary.startLabel}</p>
            </div>
            <div>
              <p className="text-xs text-[#A8A29E]">结束</p>
              <p>{view.summary.endLabel}</p>
            </div>
            <div>
              <p className="text-xs text-[#A8A29E]">时长</p>
              <p>{view.summary.durationLabel}</p>
            </div>
          </div>
          {view.summary.feedback ? (
            <p className="mt-4 rounded-xl bg-[#F5F0ED] px-3 py-3 text-sm text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {view.summary.feedback}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
          <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联任务</h2>
          <div className="mt-3 space-y-2">
            {view.linkedTasks.length > 0 ? view.linkedTasks.map((task) => (
              <div
                key={task.taskId}
                role="link"
                tabIndex={0}
                aria-label={`打开任务详情：${task.title}`}
                onClick={() => {
                  void navigate({
                    to: '/tasks/$taskId',
                    params: { taskId: task.taskId },
                    search: returnTo ? {
                      blockId: block.startId,
                      returnTo,
                      returnLabel: '时间块详情',
                    } as never : undefined,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                  }
                  event.preventDefault();
                  void navigate({
                    to: '/tasks/$taskId',
                    params: { taskId: task.taskId },
                    search: returnTo ? {
                      blockId: block.startId,
                      returnTo,
                      returnLabel: '时间块详情',
                    } as never : undefined,
                  });
                }}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-[#E7E5E4] px-3 py-2 transition-colors hover:bg-[#F8F5F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C75B3A]/40 dark:border-[#3F3F46] dark:hover:bg-[#292524]"
              >
                <div className="relative flex items-center justify-between gap-3">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none min-w-0 flex-1 rounded-lg px-1 py-0.5"
                  >
                    <p className="truncate text-sm text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{task.outcome ?? '未记录结果'}</p>
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center self-center pointer-events-auto">
                    <Link
                      to="/tasks/dag"
                      search={{ focus: task.taskId, locate: '1' } as never}
                      aria-label={`在任务依赖图中定位：${task.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#57534E] transition-colors hover:bg-[#E7E3E0] dark:bg-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#3C3836]"
                    >
                      <Waypoints size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            )) : (
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">这个时间块没有关联任务。</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
          <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联日志</h2>
          <div className="mt-4 space-y-3">
            {timelineItems.length > 0 ? timelineItems.map((item) => (
              <article key={item.id} className="flex gap-3">
                <span className={`mt-1 h-2 w-2 rounded-full ${toneDotClassName(item.tone)}`} />
                <div className="min-w-0 flex-1">
                  {item.title ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                      <p className="text-xs text-[#A8A29E]">{item.timeLabel}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-[#A8A29E]">{item.timeLabel}</p>
                  )}
                  <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      components={{
                        p: ({ ...props }) => <p className="m-0" {...props} />,
                        ul: ({ ...props }) => <ul className="my-1 list-disc pl-4" {...props} />,
                        ol: ({ ...props }) => <ol className="my-1 list-decimal pl-4" {...props} />,
                        li: ({ ...props }) => <li className="my-0" {...props} />,
                        code: ({ className, ...props }) => (
                          <code
                            className={`rounded bg-[#F5F0ED] px-1 py-0.5 dark:bg-[#292524] ${className ?? ''}`}
                            {...props}
                          />
                        ),
                      }}
                    >
                      {item.description}
                    </ReactMarkdown>
                  </div>
                </div>
              </article>
            )) : (
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">该时间块范围内未检索到事件日志。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
