import { ArrowLeft, ChevronRight, Lock, Play, Square } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { getTaskService, getTimeBlockService, getTaskTimerService } from '@/lib/services';
import type { DependencyCheckResult } from '@/lib/services/task.service';
import type { TaskTimerFeedbackAction } from '@/lib/services/task-timer.service';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import type { ActiveBlockData } from '@/lib/types/event';

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const STATUS_DOT: Record<string, string> = {
  not_started: 'bg-gray-400',
  in_progress: 'bg-amber-500',
  suspended: 'bg-blue-400',
  completed: 'bg-emerald-500',
  abandoned: 'bg-red-400',
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
  const [parentTask, setParentTask] = useState<TaskNode | null>(null);
  const [childTasks, setChildTasks] = useState<TaskNode[]>([]);
  const [depCheck, setDepCheck] = useState<DependencyCheckResult>({ met: true, blocking: [] });
  const [depTasks, setDepTasks] = useState<Map<string, TaskNode>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!taskId) {
        setIsLoading(false);
        return;
      }
      const svc = getTaskService();
      const tbSvc = getTimeBlockService();
      const [nextTask, transitions, currentBlock] = await Promise.all([
        svc.getTask(taskId),
        svc.getAvailableTransitions(taskId),
        tbSvc.loadActiveBlock(),
      ]);
      if (disposed) return;

      setTask(nextTask as TaskNode | null);
      setAvailableTransitions(transitions);
      // Show active block only if it belongs to this task
      setActiveBlock(currentBlock?.taskId === taskId ? currentBlock : null);

      if (nextTask) {
        // Load parent task
        if (nextTask.parentId) {
          const parent = await svc.getTask(nextTask.parentId);
          if (!disposed) setParentTask(parent);
        } else {
          setParentTask(null);
        }

        // Load child tasks
        const children = await svc.getChildTasks(nextTask.id);
        if (!disposed) setChildTasks(children);

        // Check dependencies
        const check = await svc.checkDependenciesMet(nextTask.id);
        if (!disposed) setDepCheck(check);

        // Resolve dependency task names
        if (nextTask.dependsOn.length > 0) {
          const depMap = new Map<string, TaskNode>();
          for (const dep of nextTask.dependsOn) {
            const dt = await svc.getTask(dep.taskId);
            if (dt) depMap.set(dep.taskId, dt);
          }
          if (!disposed) setDepTasks(depMap);
        } else {
          if (!disposed) setDepTasks(new Map());
        }
      }

      if (!disposed) setIsLoading(false);
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
    try {
      const updated = await getTaskService().transitionTask(taskId, to);
      if (updated) {
        const transitions = await getTaskService().getAvailableTransitions(taskId);
        setTask(updated);
        setAvailableTransitions(transitions);
        // Refresh dep check after transition
        const check = await getTaskService().checkDependenciesMet(taskId);
        setDepCheck(check);
      }
    } catch {
      // transitionTask may throw on hard dep block — UI already shows disabled state
    }
  };

  const handleAbandon = async () => {
    if (!taskId) return;
    await getTaskService().abandonTask(taskId);
    void navigate({ to: '/tasks' });
  };

  const handleStartTimer = async () => {
    if (!taskId) return;
    const block = await getTaskTimerService().startTimerForTask(taskId, { mode: 'countup' });
    if (block) {
      setActiveBlock(block);
      // Refresh task state (may have transitioned to in_progress)
      const refreshed = await getTaskService().getTask(taskId);
      if (refreshed) {
        setTask(refreshed);
        const transitions = await getTaskService().getAvailableTransitions(taskId);
        setAvailableTransitions(transitions);
      }
    }
  };

  const handleStopTimer = () => {
    setShowFeedback(true);
  };

  const handleFeedbackAction = async (action: TaskTimerFeedbackAction) => {
    const updated = await getTaskTimerService().endTimerForTask(undefined, action);
    setShowFeedback(false);
    setActiveBlock(null);
    if (updated && taskId) {
      setTask(updated);
      const transitions = await getTaskService().getAvailableTransitions(taskId);
      setAvailableTransitions(transitions);
    }
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
  const hardBlocking = depCheck.blocking.filter((b) => b.type === 'hard');
  const isHardBlocked = hardBlocking.length > 0;

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
        {/* Parent task breadcrumb */}
        {parentTask && (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: parentTask.id }}
            className="inline-flex items-center gap-1 text-xs text-[#78716C] dark:text-[#A8A29E]"
          >
            <span className="max-w-[200px] truncate">{parentTask.title}</span>
            <ChevronRight size={12} />
            <span className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</span>
          </Link>
        )}

        {/* Title + description card */}
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

        {/* Properties card */}
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

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[#F5F0ED] px-2.5 py-1 text-xs text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Dependencies card */}
        {task.dependsOn.length > 0 && (
          <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <p className="mb-3 text-xs font-medium text-[#A8A29E]">依赖</p>
            <ul className="space-y-2">
              {task.dependsOn.map((dep) => {
                const depTask = depTasks.get(dep.taskId);
                const isBlocking = depCheck.blocking.some((b) => b.taskId === dep.taskId);
                return (
                  <li key={dep.taskId} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${depTask ? (STATUS_DOT[depTask.status] ?? 'bg-gray-400') : 'bg-gray-300'}`} />
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: dep.taskId }}
                        className="text-[#1C1917] underline-offset-2 hover:underline dark:text-[#FAFAF9]"
                      >
                        {depTask?.title ?? dep.taskId}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${dep.type === 'hard' ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400'}`}>
                        {dep.type === 'hard' ? '硬依赖' : '软依赖'}
                      </span>
                      {isBlocking && (
                        <Lock size={12} className="text-red-500" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {isHardBlocked && (
              <p className="mt-3 text-xs text-red-500">
                硬依赖未完成，无法启动此任务
              </p>
            )}
          </div>
        )}

        {/* Child tasks card */}
        {childTasks.length > 0 && (
          <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <p className="mb-3 text-xs font-medium text-[#A8A29E]">子任务</p>
            <ul className="space-y-2">
              {childTasks.map((child) => (
                <li key={child.id}>
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: child.id }}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[child.status] ?? 'bg-gray-400'}`} />
                      <span className="text-[#1C1917] dark:text-[#FAFAF9]">{child.title}</span>
                    </div>
                    <span className="text-xs text-[#A8A29E]">{STATUS_LABEL[child.status] ?? child.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Timer card */}
        {!isTerminal && (
          <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <p className="mb-3 text-xs font-medium text-[#A8A29E]">计时</p>
            {activeBlock ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">计时中...</span>
                  <button
                    type="button"
                    onClick={() => { void handleStopTimer(); }}
                    className="inline-flex items-center gap-1 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white"
                  >
                    <Square size={14} />
                    停止
                  </button>
                </div>
                {showFeedback && (
                  <div className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] p-3 dark:border-[#292524] dark:bg-[#0C0A09]">
                    <p className="mb-2 text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">任务进展如何？</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { void handleFeedbackAction('continue'); }}
                        className="rounded-lg bg-[#C75B3A] px-3 py-1.5 text-xs font-medium text-white"
                      >
                        继续
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleFeedbackAction('suspend'); }}
                        className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        挂起
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleFeedbackAction('complete'); }}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        完成
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={isHardBlocked}
                onClick={() => { void handleStartTimer(); }}
                className={`inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium ${
                  isHardBlocked
                    ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
                    : 'bg-[#C75B3A] text-white'
                }`}
              >
                <Play size={14} />
                开始计时
              </button>
            )}
            {task.spentMinutes ? (
              <p className="mt-2 text-xs text-[#A8A29E]">已投入 {task.spentMinutes} 分钟</p>
            ) : null}
          </div>
        )}

        {/* Actions card */}
        {!isTerminal && (
          <div className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <p className="mb-3 text-xs font-medium text-[#A8A29E]">操作</p>
            <div className="flex flex-wrap gap-2">
              {availableTransitions
                .filter((s) => s !== 'abandoned')
                .map((to) => {
                  const disabled = to === 'in_progress' && isHardBlocked;
                  return (
                    <button
                      key={to}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        void handleTransition(to);
                      }}
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${
                        disabled
                          ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
                          : 'bg-[#C75B3A] text-white'
                      }`}
                    >
                      {disabled && <Lock size={12} className="mr-1 inline-block" />}
                      {STATUS_ACTION[to] ?? to}
                    </button>
                  );
                })}
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
