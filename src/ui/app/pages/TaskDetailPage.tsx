import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getTaskService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

export function TaskDetailPage() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const [task, setTask] = useState<TaskNode | null>(null);

  useEffect(() => {
    let disposed = false;
    const loadTask = async () => {
      if (!taskId) return;
      const nextTask = await getTaskService().getTask(taskId);
      if (!disposed) setTask(nextTask as TaskNode | null);
    };
    void loadTask();
    return () => {
      disposed = true;
    };
  }, [taskId]);

  if (!task) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
          返回任务
        </Link>
        <p className="text-sm text-[#A8A29E]">任务不存在或加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="flex items-center gap-2 px-5 py-3">
        <Link to="/tasks" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务详情</h1>
      </header>

      <div className="space-y-3 px-5 pb-10">
        <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</h2>
          {task.description && (
            <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">{task.description}</p>
          )}
        </div>

        <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[#A8A29E]">状态</dt>
              <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{STATUS_LABEL[task.status] ?? task.status}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#A8A29E]">优先级</dt>
              <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{PRIORITY_LABEL[task.priority] ?? task.priority}</dd>
            </div>
            {task.estimatedMinutes && (
              <div className="flex justify-between">
                <dt className="text-[#A8A29E]">预计时长</dt>
                <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.estimatedMinutes} 分钟</dd>
              </div>
            )}
            {task.dueAt && (
              <div className="flex justify-between">
                <dt className="text-[#A8A29E]">截止时间</dt>
                <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{new Date(task.dueAt).toLocaleDateString('zh-CN')}</dd>
              </div>
            )}
          </dl>
        </div>

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
