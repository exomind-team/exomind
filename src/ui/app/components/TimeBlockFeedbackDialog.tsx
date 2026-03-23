import type { KeyboardEvent, ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  TaskStatusSelector,
  TASK_STATUS_SELECTOR_END_OPTIONS,
  type TaskStatusChoice,
} from '@/ui/app/components/TaskStatusSelector';
import type { TaskNode } from '@/lib/types/task';

const TASK_STATUS_LABEL: Record<TaskNode['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

type TaskStatusTestIds = {
  row?: (taskId: string) => string;
  selector?: (taskId: string) => string;
  optionPrefix?: (taskId: string) => string;
};

interface TimeBlockFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onFeedbackKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  feedbackPlaceholder: string;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  tasks?: TaskNode[];
  outcomes?: Record<string, TaskStatusChoice>;
  onOutcomeChange?: (taskId: string, choice: TaskStatusChoice) => void;
  dialogTestId?: string;
  feedbackTestId?: string;
  submitTestId?: string;
  textareaClassName?: string;
  submitButtonClassName?: string;
  dialogClassName?: string;
  extraContent?: ReactNode;
  taskStatusTestIds?: TaskStatusTestIds;
  autoFocusFeedback?: boolean;
}

export function TimeBlockFeedbackDialog({
  open,
  onOpenChange,
  title,
  description,
  feedback,
  onFeedbackChange,
  onFeedbackKeyDown,
  feedbackPlaceholder,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  tasks = [],
  outcomes = {},
  onOutcomeChange,
  dialogTestId = 'task-dag-end-dialog',
  feedbackTestId = 'task-dag-end-dialog-feedback',
  submitTestId = 'task-dag-end-dialog-submit',
  textareaClassName = 'min-h-[104px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]',
  submitButtonClassName = 'inline-flex items-center justify-center rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60',
  dialogClassName,
  extraContent,
  taskStatusTestIds,
  autoFocusFeedback = false,
}: TimeBlockFeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={dialogTestId}
        className={cn(
          'w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl',
          dialogClassName,
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Textarea
          data-testid={feedbackTestId}
          value={feedback}
          onChange={(event) => onFeedbackChange(event.target.value)}
          onKeyDown={onFeedbackKeyDown}
          placeholder={feedbackPlaceholder}
          autoFocus={autoFocusFeedback}
          className={textareaClassName}
        />

        {extraContent}

        {tasks.length > 0 ? (
          <div data-testid="task-dag-end-dialog-task-list" className="min-w-0 space-y-3">
            {tasks.map((task) => (
              <section
                key={task.id}
                data-testid={`task-dag-end-dialog-task-${task.id}`}
                className="min-w-0 rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] p-3 dark:border-[#292524] dark:bg-[#120F0D]"
              >
                <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 whitespace-normal break-all [overflow-wrap:anywhere] text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                    {task.title}
                  </p>
                  <span className="shrink-0 text-[11px] text-[#A8A29E]">{TASK_STATUS_LABEL[task.status]}</span>
                </div>
                <div data-testid={taskStatusTestIds?.row?.(task.id)}>
                  <TaskStatusSelector
                    data-testid={taskStatusTestIds?.selector?.(task.id) ?? `task-dag-end-dialog-status-${task.id}`}
                    optionTestIdPrefix={taskStatusTestIds?.optionPrefix?.(task.id)}
                    value={outcomes[task.id] ?? 'suspended'}
                    allowedChoices={TASK_STATUS_SELECTOR_END_OPTIONS}
                    onChange={(choice) => onOutcomeChange?.(task.id, choice)}
                  />
                </div>
              </section>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            data-testid={submitTestId}
            disabled={submitDisabled}
            onClick={onSubmit}
            className={submitButtonClassName}
          >
            {submitLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
