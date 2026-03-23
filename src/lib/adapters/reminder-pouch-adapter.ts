import type { IReminderPort } from '@/lib/environment/interfaces/reminder.port';
import { getCurrentUserId } from '@/lib/storage/event-storage';
import { getReminderStorage } from '@/lib/storage/reminder-storage';
import {
  transitionReminder,
  type CreateReminderInput,
  type Reminder,
  type ReminderStatus,
  type UpdateReminderInput,
} from '@/lib/types/reminder';
import { createUuidV4 } from '@/lib/utils/uuid';

export class ReminderPouchAdapter implements IReminderPort {
  constructor(private readonly userId?: string) {}

  private get storage() {
    return getReminderStorage(this.userId || getCurrentUserId());
  }

  async listReminders(): Promise<Reminder[]> {
    return this.storage.getReminders();
  }

  async getReminderById(id: string): Promise<Reminder | null> {
    const reminder = await this.storage.getReminder(id);
    return reminder ?? null;
  }

  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const now = Date.now();
    const reminder: Reminder = {
      id: createUuidV4(),
      title: input.title.trim(),
      content: input.content,
      dueAt: input.dueAt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.addReminder(reminder);
    return reminder;
  }

  async updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder | null> {
    const updates: UpdateReminderInput = {
      ...input,
      ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}),
    };
    const updated = await this.storage.updateReminder(id, updates);
    return updated ?? null;
  }

  async transitionReminder(id: string, to: ReminderStatus, at = Date.now()): Promise<Reminder | null> {
    const current = await this.storage.getReminder(id);
    if (!current) return null;

    const next = transitionReminder(current, to, at);
    const updated = await this.storage.updateReminder(id, {
      status: next.status,
      completedAt: next.completedAt,
      updatedAt: next.updatedAt,
    });
    return updated ?? next;
  }

  async startSync(remoteUrl: string): Promise<void> {
    await this.storage.syncToRemote(remoteUrl);
  }

  async stopSync(): Promise<void> {
    await this.storage.stopSync();
  }

  onRemoteChange(callback: (change: unknown) => void): () => void {
    return this.storage.onRemoteChange(callback);
  }
}
