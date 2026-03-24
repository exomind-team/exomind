import { ReminderPouchAdapter } from '@/lib/adapters/reminder-pouch-adapter';
import type { IReminderPort } from '@/lib/environment/interfaces/reminder.port';
import type {
  CreateReminderInput,
  Reminder,
  ReminderStatus,
  UpdateReminderInput,
} from '@/lib/types/reminder';

export interface ReminderService {
  listReminders(): Promise<Reminder[]>;
  listRemindersByStatus(status: ReminderStatus): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | null>;
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder | null>;
  markTriggered(id: string, triggeredAt?: number): Promise<Reminder | null>;
  completeReminder(id: string, completedAt?: number): Promise<Reminder | null>;
  getDuePendingReminders(at?: number): Promise<Reminder[]>;
  startSync(remoteUrl: string): Promise<void>;
  stopSync(): Promise<void>;
  onReminderChange(callback: () => void): () => void;
}

function normalizeDueAt(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('提醒时间无效');
  }
  return Math.trunc(value);
}

function assertNonEmptyTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error('提醒标题不能为空');
  }
  return normalized;
}

export class ReminderServiceImpl implements ReminderService {
  private readonly port: IReminderPort;
  private syncUnsubscribe: (() => void) | null = null;
  private changeListeners = new Set<() => void>();

  constructor(port?: IReminderPort) {
    this.port = port ?? new ReminderPouchAdapter();
  }

  listReminders(): Promise<Reminder[]> {
    return this.port.listReminders();
  }

  async listRemindersByStatus(status: ReminderStatus): Promise<Reminder[]> {
    const reminders = await this.port.listReminders();
    return reminders.filter((reminder) => reminder.status === status);
  }

  getReminder(id: string): Promise<Reminder | null> {
    return this.port.getReminderById(id);
  }

  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const created = await this.port.createReminder({
      ...input,
      title: assertNonEmptyTitle(input.title),
      dueAt: normalizeDueAt(input.dueAt),
    });
    this.notifyChangeListeners();

    if (created.dueAt <= Date.now()) {
      const triggered = await this.port.transitionReminder(created.id, 'triggered', Date.now());
      this.notifyChangeListeners();
      return triggered ?? created;
    }

    return created;
  }

  async updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder | null> {
    const current = await this.port.getReminderById(id);
    if (!current) return null;

    if (current.status !== 'pending') {
      throw new Error('仅未到期提醒可编辑');
    }

    const patch: UpdateReminderInput = {};
    if (typeof input.title === 'string') {
      patch.title = assertNonEmptyTitle(input.title);
    }
    if (typeof input.content === 'string') {
      patch.content = input.content;
    }
    if (typeof input.dueAt === 'number') {
      patch.dueAt = normalizeDueAt(input.dueAt);
    }

    const updated = await this.port.updateReminder(id, patch);
    if (!updated) return null;

    this.notifyChangeListeners();

    if (updated.dueAt <= Date.now()) {
      const triggered = await this.port.transitionReminder(updated.id, 'triggered', Date.now());
      this.notifyChangeListeners();
      return triggered ?? updated;
    }

    return updated;
  }

  async markTriggered(id: string, triggeredAt = Date.now()): Promise<Reminder | null> {
    const current = await this.port.getReminderById(id);
    if (!current) return null;
    if (current.status === 'triggered' || current.status === 'completed') return current;

    const triggered = await this.port.transitionReminder(id, 'triggered', triggeredAt);
    if (triggered) {
      this.notifyChangeListeners();
    }
    return triggered;
  }

  async completeReminder(id: string, completedAt = Date.now()): Promise<Reminder | null> {
    const current = await this.port.getReminderById(id);
    if (!current) return null;
    if (current.status === 'completed') return current;

    const completed = await this.port.transitionReminder(id, 'completed', completedAt);
    if (completed) {
      this.notifyChangeListeners();
    }
    return completed;
  }

  async getDuePendingReminders(at = Date.now()): Promise<Reminder[]> {
    const reminders = await this.port.listReminders();
    return reminders
      .filter((reminder) => reminder.status === 'pending' && reminder.dueAt <= at)
      .sort((left, right) => left.dueAt - right.dueAt);
  }

  async startSync(remoteUrl: string): Promise<void> {
    if (!this.syncUnsubscribe) {
      this.syncUnsubscribe = this.port.onRemoteChange(() => {
        this.notifyChangeListeners();
      });
    }
    await this.port.startSync(remoteUrl);
  }

  async stopSync(): Promise<void> {
    if (this.syncUnsubscribe) {
      this.syncUnsubscribe();
      this.syncUnsubscribe = null;
    }
    await this.port.stopSync();
  }

  onReminderChange(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  private notifyChangeListeners(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // ignore listener exceptions
      }
    }
  }
}

let reminderServiceInstance: ReminderService | null = null;

export function getReminderService(): ReminderService {
  if (!reminderServiceInstance) {
    reminderServiceInstance = new ReminderServiceImpl();
  }
  return reminderServiceInstance;
}
