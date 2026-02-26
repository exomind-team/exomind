export type TimeBlockNotificationAction = 'start' | 'pause' | 'resume' | 'end' | 'open';

const TIMEBLOCK_NOTIFICATION_ACTION_EVENT = 'exomind:timeblock-notification-action';

let pendingAction: TimeBlockNotificationAction | null = null;

export function dispatchTimeBlockNotificationAction(action: TimeBlockNotificationAction): void {
  pendingAction = action;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TimeBlockNotificationAction>(TIMEBLOCK_NOTIFICATION_ACTION_EVENT, { detail: action }));
}

export function subscribeTimeBlockNotificationAction(listener: (action: TimeBlockNotificationAction) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<TimeBlockNotificationAction>;
    if (!customEvent.detail) return;
    listener(customEvent.detail);
  };

  window.addEventListener(TIMEBLOCK_NOTIFICATION_ACTION_EVENT, handleEvent);
  return () => {
    window.removeEventListener(TIMEBLOCK_NOTIFICATION_ACTION_EVENT, handleEvent);
  };
}

export function consumePendingTimeBlockNotificationAction(): TimeBlockNotificationAction | null {
  const action = pendingAction;
  pendingAction = null;
  return action;
}

