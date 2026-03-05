import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { getTaskService } from '@/lib/services';
import type { TaskNode, TaskStatus } from '@/lib/types/task';

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const STATUS_ACTION: Record<string, string> = {
  in_progress: '开始',
  suspended: '挂起',
  completed: '完成',
  not_started: '回退',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

export function TaskDetailPage() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskNode | null>(null);
  const [availableTransitions, setAvailableTransitions] = useState<TaskStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!taskId) {
        setIsLoading(false);
        return;
      }
      const [nextTask, transitions] = await Promise.all([
        getTaskService().getTask(taskId),
        getTaskService().getAvailableTransitions(taskId),
      ]);
      if (!disposed) {
        setTask(nextTask as TaskNode | null);
        setAvailableTransitions(transitions);
        setIsLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleClick = () => {
    if (!task) return;
    setEditTitle(task.title);
    setIsEditingTitle(true);
  };

  const handleTitleSave = async () => {
    if (!task || !taskId) return;
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== task.title) {
      const updated = await getTaskService().updateTask(taskId, { title: trimmed });
      if (updated) setTask(updated);
    }
    setIsEditingTitle(false);
  };

  const handleTransition = async (to: TaskStatus) => {
    if (!taskId) return;
    const updated = await getTaskService().transitionTask(taskId, to);
    if (updated) {
      const transitions = await getTaskService().getAvailableTransitions(taskId);
      setTask(updated);
      setAvailableTransitions(transitions);
    }
  };

  const handleAbandon = async () => {
    if (!taskId) return;
    await getTaskService().abandonTask(taskId);
    void navigate({ to: '/tasks' });
  };

  if (isLoading) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
          返回任务
        </Link>
        <p className="text-sm text-[#A8A29E]">加载中...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-full bg-[#FAF7F5] px-6 py-6 dark:bg-[#0C0A09]">
        <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          <ArrowLeft size={16} />
          返回任务
        </Link>
        <p className="text-sm text-[#A8A29E]">任务不存在</p>
      </div>
    );
  }

  const isTerminal = task.status === 'completed' || task.status === 'abandoned';

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-task-detail-page">
      <header className="flex items-center gap-2 px-5 py-3">
        <Link
          to="/tasks"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务详情</h1>
      </header>

      <div className="space-y-3 px-5 pb-10">
        <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => {
                void handleTitleSave();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleTitleSave();
                }
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                }
              }}
              className="w-full border-none bg-transparent text-base font-semibold text-[#1C1917] outline-none dark:text-[#FAFAF9]"
            />
          ) : (
            <button
              type="button"
              onClick={handleTitleClick}
              className="w-full text-left text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
            >
              {task.title}
            </button>
          )}
          {task.description && <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">{task.description}</p>}
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
            {task.estimatedMinutes ? (
              <div className="flex justify-between">
                <dt className="text-[#A8A29E]">预计时长</dt>
                <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.estimatedMinutes} 分钟</dd>
              </div>
            ) : null}
            {task.dueAt ? (
              <div className="flex justify-between">
                <dt className="text-[#A8A29E]">截止时间</dt>
                <dd className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{new Date(task.dueAt).toLocaleDateString('zh-CN')}</dd>
              </div>
            ) : null}
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

        {!isTerminal && (
          <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <p className="mb-3 text-xs font-medium text-[#A8A29E]">操作</p>
            <div className="flex flex-wrap gap-2">
              {availableTransitions
                .filter((s) => s !== 'abandoned')
                .map((to) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => {
                      void handleTransition(to);
                    }}
                    className="rounded-xl bg-[#C75B3A] px-4 py-2 text-sm font-medium text-white"
                  >
                    {STATUS_ACTION[to] ?? to}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => {
                  void handleAbandon();
                }}
                className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-500 dark:border-red-900"
              >
                放弃任务
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
