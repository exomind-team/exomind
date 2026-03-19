import { useEffect, useMemo, useState } from 'react';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import type { TaskStatusChoice } from '@/ui/app/components/TaskStatusSelector';
import {
  resolveFeedbackSubmitLabel,
  useFeedbackSubmitControls,
} from '@/ui/app/components/useFeedbackSubmitControls';
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
  const {
    canSubmitFeedback,
    handleFeedbackKeyDown,
    isSkipFeedbackCoolingDown,
    resetSkipFeedbackConfirm,
    skipFeedbackConfirmState,
    skipFeedbackCountdownSec,
  } = useFeedbackSubmitControls();

  const normalizedTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  useEffect(() => {
    if (!open) {
      return;
    }

    resetSkipFeedbackConfirm();
    setFeedback('');
    setOutcomes(
      normalizedTaskIds.reduce<Record<string, TaskStatusChoice>>((next, taskId) => {
        next[taskId] = 'continue';
        return next;
      }, {}),
    );
  }, [normalizedTaskIds, open, resetSkipFeedbackConfirm]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!canSubmitFeedback(feedback)) return;

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
    <TimeBlockFeedbackDialog
      open={open}
      onOpenChange={onOpenChange}
      title="结束时间块"
      description="记录反馈，并分别设置本次关联任务的后续状态。"
      feedback={feedback}
      onFeedbackChange={(value) => {
        resetSkipFeedbackConfirm();
        setFeedback(value);
      }}
      onFeedbackKeyDown={(event) => {
        handleFeedbackKeyDown(event, handleSubmit, (nextValue) => {
          resetSkipFeedbackConfirm();
          setFeedback(nextValue);
        });
      }}
      feedbackPlaceholder="记录本次执行反馈..."
      onSubmit={() => {
        void handleSubmit();
      }}
      submitLabel={resolveFeedbackSubmitLabel({
        feedback,
        isSubmitting,
        skipConfirmState: skipFeedbackConfirmState,
        skipConfirmCountdownSec: skipFeedbackCountdownSec,
        defaultLabel: '提交反馈并结束',
      })}
      submitDisabled={isSubmitting || isSkipFeedbackCoolingDown}
      tasks={tasks}
      outcomes={outcomes}
      onOutcomeChange={(taskId, choice) => {
        setOutcomes((current) => ({
          ...current,
          [taskId]: choice,
        }));
      }}
    />
  );
}
