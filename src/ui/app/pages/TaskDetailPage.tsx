import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getTaskService } from '@/lib/services';
import type { TaskItem } from '@/lib/types/task';
import { TaskTimerCard } from '@/ui/app/components/TaskTimerCard';

export function TaskDetailPage() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const [task, setTask] = useState<TaskItem | null>(null);

  useEffect(() => {
    let disposed = false;
    const loadTask = async () => {
      if (!taskId) return;
      const nextTask = await getTaskService().getTask(taskId);
      if (!disposed) setTask(nextTask);
    };
    void loadTask();
    return () => {
      disposed = true;
    };
  }, [taskId]);

  if (!task) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09] md:px-8 lg:px-10">
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
      <header className="flex items-center gap-2 border-b border-[#F0ECE8] px-5 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <Link to="/tasks" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务详情</h1>
      </header>

      <TaskTimerCard
        task={task}
        onModeChange={(mode) => {
          void getTaskService().setTimerMode(task.id, mode).then((updated) => {
            if (updated) setTask(updated);
          });
        }}
        onPauseToggle={(paused) => {
          const action = paused ? getTaskService().pauseTask : getTaskService().resumeTask;
          void action(task.id).then((updated) => {
            if (updated) setTask(updated);
          });
        }}
      />
    </div>
  );
}

