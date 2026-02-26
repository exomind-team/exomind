import type { TimeBlockNotificationAction } from './timeblock-notification-dispatcher';

export interface TimeBlockActionWidgetHandle {
  expandAndFocusTaskName: () => void;
  getTimerState: () => 'idle' | 'running' | 'paused' | 'ended';
  pauseOrResume: () => Promise<void>;
  endDialog: () => void;
}

export async function applyTimeBlockNotificationActionToWidget(
  action: TimeBlockNotificationAction,
  widget: TimeBlockActionWidgetHandle | null,
): Promise<void> {
  if (!widget) return;

  const timerState = widget.getTimerState();

  if (action === 'start') {
    widget.expandAndFocusTaskName();
    return;
  }

  if (action === 'pause') {
    if (timerState === 'running') {
      await widget.pauseOrResume();
    }
    return;
  }

  if (action === 'resume') {
    if (timerState === 'paused') {
      await widget.pauseOrResume();
    }
    return;
  }

  if (action === 'end') {
    if (timerState === 'running' || timerState === 'paused') {
      widget.endDialog();
    }
  }
}
