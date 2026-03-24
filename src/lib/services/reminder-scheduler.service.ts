import type { Reminder } from '@/lib/types/reminder';
import { getReminderService, type ReminderService } from './reminder.service';

export const DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS = 30_000;

export interface ReminderSchedulerService {
  start(intervalMs?: number): void;
  stop(): void;
  runNow(): Promise<void>;
  onTriggered(listener: (reminder: Reminder) => void): () => void;
}

export class ReminderSchedulerServiceImpl implements ReminderSchedulerService {
  private readonly reminderService: ReminderService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS;
  private listeners = new Set<(reminder: Reminder) => void>();
  private inFlight = false;
  private notifiedTriggeredIds = new Set<string>();

  constructor(reminderService?: ReminderService) {
    this.reminderService = reminderService ?? getReminderService();
  }

  start(intervalMs = DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS): void {
    const normalizedInterval = Number.isFinite(intervalMs) && intervalMs >= 5_000
      ? Math.trunc(intervalMs)
      : DEFAULT_REMINDER_SCHEDULER_INTERVAL_MS;

    if (this.timer) {
      if (this.pollIntervalMs === normalizedInterval) {
        return;
      }
      this.stop();
    }

    this.pollIntervalMs = normalizedInterval;
    void this.runNow();
    this.timer = setInterval(() => {
      void this.runNow();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const now = Date.now();
      const duePending = await this.reminderService.getDuePendingReminders(now);

      for (const pendingReminder of duePending) {
        const triggered = await this.reminderService.markTriggered(pendingReminder.id, now);
        if (triggered && triggered.status === 'triggered') {
          this.notifiedTriggeredIds.add(triggered.id);
          this.emitTriggered(triggered);
        }
      }

      const allReminders = await this.reminderService.listReminders();
      const triggeredReminders = allReminders.filter((reminder) => reminder.status === 'triggered');
      const activeTriggeredIds = new Set(triggeredReminders.map((reminder) => reminder.id));

      for (const triggeredReminder of triggeredReminders) {
        if (this.notifiedTriggeredIds.has(triggeredReminder.id)) {
          continue;
        }

        this.notifiedTriggeredIds.add(triggeredReminder.id);
        this.emitTriggered(triggeredReminder);
      }

      for (const knownId of Array.from(this.notifiedTriggeredIds)) {
        if (!activeTriggeredIds.has(knownId)) {
          this.notifiedTriggeredIds.delete(knownId);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  onTriggered(listener: (reminder: Reminder) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitTriggered(reminder: Reminder): void {
    for (const listener of this.listeners) {
      try {
        listener(reminder);
      } catch {
        // ignore listener exceptions
      }
    }
  }
}

let reminderSchedulerServiceInstance: ReminderSchedulerService | null = null;

export function getReminderSchedulerService(): ReminderSchedulerService {
  if (!reminderSchedulerServiceInstance) {
    reminderSchedulerServiceInstance = new ReminderSchedulerServiceImpl();
  }
  return reminderSchedulerServiceInstance;
}
