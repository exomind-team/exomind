import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { TaskStatusSelector, type TaskStatusChoice } from '@/ui/app/components/TaskStatusSelector';
import type { TaskNode } from '@/lib/types/task';

interface MultiTaskEndDialogProps {
  open: boolean;
  tasks: TaskNode[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    feedback: string;
    outcomes: Record<string, TaskStatusChoice>;
  }) => Promise<void>;
}

export function MultiTaskEndDialog({
  open,
  tasks,
  onOpenChange,
  onSubmit,
}: MultiTaskEndDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, TaskStatusChoice>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFeedback('');
    setOutcomes(
      normalizedTaskIds.reduce<Record<string, TaskStatusChoice>>((next, taskId) => {
        next[taskId] = 'continue';
        return next;
      }, {}),
    );
  }, [normalizedTaskIds, open]);

  const handleSubmit = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        feedback: feedback.trim(),
        outcomes,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="task-dag-end-dialog" className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>结束时间块</DialogTitle>
          <DialogDescription>记录反馈，并分别设置本次关联任务的后续状态。</DialogDescription>
        </DialogHeader>

        <Textarea
          data-testid="task-dag-end-dialog-feedback"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="记录本次执行反馈..."
          className="min-h-[104px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
        />

        <div data-testid="task-dag-end-dialog-task-list" className="space-y-3">
          {tasks.map((task) => (
            <section
              key={task.id}
              data-testid={`task-dag-end-dialog-task-${task.id}`}
              className="rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] p-3 dark:border-[#292524] dark:bg-[#120F0D]"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
                <span className="shrink-0 text-[11px] text-[#A8A29E]">{task.status}</span>
              </div>
              <TaskStatusSelector
                data-testid={`task-dag-end-dialog-status-${task.id}`}
                linkedTaskTitle={task.title}
                value={outcomes[task.id] ?? 'continue'}
                onChange={(choice) => {
                  setOutcomes((current) => ({
                    ...current,
                    [task.id]: choice,
                  }));
                }}
              />
            </section>
          ))}
        </div>

        <DialogFooter>
          <button
            type="button"
            data-testid="task-dag-end-dialog-submit"
            disabled={isSubmitting}
            onClick={() => {
              void handleSubmit();
            }}
            className="inline-flex items-center justify-center rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            提交反馈并结束
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
