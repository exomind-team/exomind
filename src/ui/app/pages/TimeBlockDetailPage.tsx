import { Link, useLocation, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { getTaskService, getTimeBlockService } from '@/lib/services';
import { resolveActiveBlockTaskIds, type ActiveBlockData, type TimeBlock } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { buildTimeBlockDetailView } from './timeblock-detail-view';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';

function resolveActiveTaskIds(block: ActiveBlockData): string[] {
  return resolveActiveBlockTaskIds(block);
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
  const [block, setBlock] = useState<TimeBlock | null>(null);
  const [tasksById, setTasksById] = useState<Map<string, TaskNode>>(new Map());
  const [loading, setLoading] = useState(true);
  const isNowDomain = location.pathname.startsWith('/eventlog/');
  const backLink = isNowDomain
    ? { label: '当下', to: '/eventlog' }
    : { label: '任务', to: '/tasks' };

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      const timeBlockService = getTimeBlockService();
      const taskService = getTaskService();
      const [blocks, activeBlock] = await Promise.all([
        timeBlockService.loadTimeBlocks(),
        timeBlockService.loadActiveBlock(),
      ]);

      let matchedBlock = blocks.find((item) => item.id === blockId || item.startId === blockId) ?? null;
      if (!matchedBlock && activeBlock && activeBlock.startId === blockId) {
        matchedBlock = buildRunningTimeBlock(activeBlock, Date.now());
      }

      const taskIds = matchedBlock ? resolveActiveBlockTaskIds(matchedBlock) : [];
      const tasks = await Promise.all(taskIds.map((taskId) => taskService.getTask(taskId)));

      if (disposed) return;
      setBlock(matchedBlock);
      setTasksById(new Map(tasks.filter((task): task is TaskNode => Boolean(task)).map((task) => [task.id, task])));
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
      <div className="mx-auto max-w-4xl space-y-4">
        <TaskBreadcrumb
          segments={[backLink]}
          current={{ label: '时间块详情' }}
        />

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
              <div key={task.taskId} className="rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#3F3F46]">
                <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{task.outcome ?? '未记录结果'}</p>
              </div>
            )) : (
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">这个时间块没有关联任务。</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-5 dark:border-[#292524] dark:bg-[#1C1917]">
          <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">关联日志</h2>
          <div className="mt-3 space-y-2">
            {view.associationTimeline.length > 0 ? view.associationTimeline.map((item) => (
              <div key={item.id} className="rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#3F3F46]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{item.title}</p>
                  <p className="text-xs text-[#A8A29E]">{item.timestampLabel}</p>
                </div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{item.action} · {item.source}</p>
              </div>
            )) : (
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">暂无关联日志。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
