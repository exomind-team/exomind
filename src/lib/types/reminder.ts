export type ReminderStatus = 'pending' | 'triggered' | 'completed';

export interface Reminder {
  id: string;
  title: string;
  content: string;
  dueAt: number;
  status: ReminderStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CreateReminderInput {
  title: string;
  content: string;
  dueAt: number;
}

export interface UpdateReminderInput {
  title?: string;
  content?: string;
  dueAt?: number;
}

const VALID_TRANSITIONS: Record<ReminderStatus, ReminderStatus[]> = {
  pending: ['triggered', 'completed'],
  triggered: ['completed'],
  completed: [],
};

export function canTransitionReminder(from: ReminderStatus, to: ReminderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function transitionReminder(
  reminder: Reminder,
  to: ReminderStatus,
  at: number = Date.now(),
): Reminder {
  if (!canTransitionReminder(reminder.status, to)) {
    throw new Error(`Invalid reminder transition: ${reminder.status} -> ${to}`);
  }

  return {
    ...reminder,
    status: to,
    updatedAt: at,
    ...(to === 'completed' ? { completedAt: at } : {}),
  };
}
